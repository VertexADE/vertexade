#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const dataDirectory = join(root, 'data')
const deploymentPath = join(dataDirectory, 'deployment.json')
const temporaryDeploymentPath = `${deploymentPath}.tmp`
const temporaryDirectory = join(dataDirectory, 'tmp')
const webOutputPath = join(root, 'apps/web/.output')
const stagedWebOutputPath = join(root, 'apps/web/.output-next')
const previousWebOutputPath = join(root, 'apps/web/.output-previous')
const healthUrl = process.env.VERTEXADE_HEALTH_URL || 'http://127.0.0.1:4173/api/health/ready'

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
      ...options,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal || code}`))
    })
  })
}

async function timed(label, action, timings) {
  const startedAt = performance.now()
  process.stdout.write(`Starting ${label}\n`)
  try {
    return await action()
  } finally {
    const elapsedSeconds = Number(((performance.now() - startedAt) / 1_000).toFixed(3))
    timings[label] = elapsedSeconds
    process.stdout.write(`Finished ${label} in ${elapsedSeconds.toFixed(3)}s\n`)
  }
}

function output(command, args) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: process.env,
    })
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise(Buffer.concat(chunks).toString().trim())
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

async function requireCleanCommit() {
  const dirty = await output('git', ['status', '--porcelain'])
  if (dirty) throw new Error('Verified deployment requires a clean working tree')
  return output('git', ['rev-parse', 'HEAD'])
}

async function probe() {
  let lastError
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (!body || typeof body.ready !== 'boolean') throw new Error('Health response is malformed')
      return
    } catch (error) {
      lastError = error
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, 1_000)
      })
    }
  }
  throw new Error(`Deployment health probe failed: ${lastError instanceof Error ? lastError.message : lastError}`)
}

async function promoteWebBuild() {
  await access(join(stagedWebOutputPath, 'server/index.mjs'))
  await rm(previousWebOutputPath, { recursive: true, force: true })
  await rename(webOutputPath, previousWebOutputPath)
  try {
    await rename(stagedWebOutputPath, webOutputPath)
  } catch (error) {
    await rename(previousWebOutputPath, webOutputPath)
    throw error
  }
}

async function restartServices() {
  const deploymentEnvironment = { ...process.env, APP_ROOT: root }
  await run('pm2', ['restart', 'vertexade-api', 'vertexade', '--update-env'], {
    env: deploymentEnvironment,
  })
  const processes = JSON.parse(await output('pm2', ['jlist']))
  for (const name of ['vertexade-api', 'vertexade']) {
    const service = processes.find((processEntry) => processEntry.name === name)
    if (!service) throw new Error(`PM2 service ${name} is missing after restart`)
    if (service.pm2_env?.pm_cwd !== root || service.pm2_env?.APP_ROOT !== root) {
      throw new Error(`PM2 service ${name} is using a different application root`)
    }
  }
  await probe()
}

async function restorePreviousWebBuild() {
  await rm(stagedWebOutputPath, { recursive: true, force: true })
  await rename(webOutputPath, stagedWebOutputPath)
  await rename(previousWebOutputPath, webOutputPath)
  await restartServices()
}

async function main() {
  const commitSha = await requireCleanCommit()
  const startedAt = new Date().toISOString()
  const timings = {}
  await mkdir(temporaryDirectory, { recursive: true })
  await rm(stagedWebOutputPath, { recursive: true, force: true })
  await timed('check', () => run('vp', ['run', 'verify:check']), timings)
  await timed('test', () => run('vp', ['run', 'verify:test'], { env: { ...process.env, TMPDIR: temporaryDirectory } }), timings)
  await timed('webBuild', () => run('vp', ['run', 'stage:web']), timings)
  await timed('webPromotion', promoteWebBuild, timings)
  try {
    await timed('serviceRestartAndHealth', restartServices, timings)
  } catch (error) {
    await restorePreviousWebBuild().catch(() => undefined)
    throw error
  }
  await timed('processSave', () => run('pm2', ['save']), timings)
  const deployment = {
    commitSha,
    startedAt,
    deployedAt: new Date().toISOString(),
    healthUrl,
    status: 'verified',
    timings,
  }
  await mkdir(dataDirectory, { recursive: true })
  await writeFile(temporaryDeploymentPath, `${JSON.stringify(deployment, null, 2)}\n`, {
    mode: 0o600,
  })
  await rename(temporaryDeploymentPath, deploymentPath)
  process.stdout.write(`Verified deployment ${commitSha.slice(0, 12)}\n`)
}

main().catch(async (error) => {
  const previous = await readFile(deploymentPath, 'utf8').catch(() => '')
  let previousDeployment = null
  try {
    previousDeployment = previous ? JSON.parse(previous) : null
  } catch {}
  const failure = {
    status: 'failed',
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    previous: previousDeployment,
  }
  await mkdir(dataDirectory, { recursive: true }).catch(() => undefined)
  await writeFile(join(dataDirectory, 'deployment-failure.json'), `${JSON.stringify(failure, null, 2)}\n`, {
    mode: 0o600,
  }).catch(() => undefined)
  process.stderr.write(`${failure.error}\n`)
  process.exitCode = 1
})

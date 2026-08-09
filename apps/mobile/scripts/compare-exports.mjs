#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { arch, hostname, platform, release, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mobileRoot, runExpo, runReleaseExport } from './hermes-release.mjs'

const require = createRequire(import.meta.url)
const { isHermesBytecode, isPlainJavaScript, runCli } = require('./hermes-release-policy.cjs')
const repositoryRoot = resolve(mobileRoot, '../..')
const reportDirectory = resolve(repositoryRoot, 'artifacts/mobile-performance')
const reportPath = join(reportDirectory, 'bundle-comparison.json')

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)))
    else if (entry.isFile()) files.push({ absolutePath: path, path: relative(root, path).replaceAll('\\', '/') })
  }
  return files
}

async function describeExport(root) {
  const files = await listFiles(root)
  const described = await Promise.all(
    files.map(async (file) => {
      const contents = await readFile(file.absolutePath)
      const sourceMap = file.path.endsWith('.map')
      return {
        path: file.path,
        bytes: contents.length,
        sha256: createHash('sha256').update(contents).digest('hex'),
        hermesBytecode: isHermesBytecode(contents),
        plainJavaScript: !sourceMap && isPlainJavaScript(contents) && /\.(?:js|hbc)$/.test(file.path),
        sourceMap,
      }
    }),
  )
  return {
    totalBytes: described.reduce((total, file) => total + file.bytes, 0),
    files: described.sort((left, right) => left.path.localeCompare(right.path)),
  }
}

function platformBundle(exportDescription, target) {
  const candidates = exportDescription.files.filter(
    (file) => file.path.includes(`/${target}/`) && (file.hermesBytecode || file.plainJavaScript),
  )
  return candidates.sort((left, right) => right.bytes - left.bytes)[0] || null
}

function packageVersion(name) {
  return require(require.resolve(`${name}/package.json`)).version
}

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

async function timed(command, action) {
  const startedAt = new Date()
  const start = performance.now()
  try {
    await action()
    return timedResult(command, startedAt, start, 0)
  } catch (error) {
    return timedResult(command, startedAt, start, errorCode(error), errorMessage(error))
  }
}

function timedResult(command, startedAt, start, exitCode, error) {
  return {
    command,
    startedAt: startedAt.toISOString(),
    durationMs: Math.round(performance.now() - start),
    exitCode,
    ...(error ? { error } : {}),
  }
}

function errorCode(error) {
  return Number.isInteger(error?.code) ? error.code : 1
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function requiredBundle(bundle, message) {
  if (!bundle) throw new Error(message)
  return bundle
}

function assertBundle(condition, message) {
  if (!condition) throw new Error(message)
}

function targetComparison(releaseExport, analysisExport, target) {
  const releaseBundle = requiredBundle(platformBundle(releaseExport, target), `Release export is missing a ${target} bundle`)
  const analysisBundle = requiredBundle(platformBundle(analysisExport, target), `Analysis export is missing a ${target} bundle`)
  assertBundle(releaseBundle.hermesBytecode, `Release ${target} bundle is not Hermes bytecode`)
  assertBundle(analysisBundle.plainJavaScript, `Analysis ${target} bundle is not plain JavaScript`)
  assertBundle(
    analysisExport.files.some((file) => file.sourceMap && file.path.includes(`/${target}/`)),
    `Analysis export is missing a ${target} source map`,
  )
  const byteDelta = releaseBundle.bytes - analysisBundle.bytes
  return {
    releaseBundle,
    analysisBundle,
    byteDelta,
    percentDelta: Math.round((byteDelta / analysisBundle.bytes) * 10_000) / 100,
  }
}

function validateComparison(releaseExport, analysisExport) {
  return Object.fromEntries(
    ['android', 'ios'].map((target) => [target, targetComparison(releaseExport, analysisExport, target)]),
  )
}

async function successfulRun(report, command, action) {
  const result = await timed(command, action)
  report.commands.push(result)
  if (result.exitCode !== 0) throw new Error(result.error)
}

async function main() {
  await mkdir(reportDirectory, { recursive: true })
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'vertexade-mobile-exports-'))
  const releaseDirectory = join(temporaryRoot, 'release')
  const analysisDirectory = join(temporaryRoot, 'analysis')
  const report = {
    schemaVersion: 1,
    status: 'failed',
    generatedAt: new Date().toISOString(),
    commit: currentCommit(),
    host: { hostname: hostname(), platform: platform(), release: release(), architecture: arch(), node: process.version },
    versions: {
      expo: packageVersion('expo'),
      reactNative: packageVersion('react-native'),
      hermesCompiler: packageVersion('hermes-compiler'),
      runtimeVersion: require(resolve(mobileRoot, 'app.json')).expo.runtimeVersion,
    },
    commands: [],
  }

  try {
    const releaseCommand = 'expo export --platform all --output-dir <temp>/release --clear'
    await successfulRun(report, releaseCommand, () =>
      runReleaseExport(['--platform', 'all', '--output-dir', releaseDirectory, '--clear']),
    )

    const analysisCommand = 'expo export --platform all --output-dir <temp>/analysis --clear --no-bytecode --source-maps'
    await successfulRun(report, analysisCommand, () =>
      runExpo(
        ['export', '--platform', 'all', '--output-dir', analysisDirectory, '--clear', '--no-bytecode', '--source-maps'],
        { cwd: mobileRoot },
      ),
    )

    report.release = await describeExport(releaseDirectory)
    report.analysis = await describeExport(analysisDirectory)
    report.platforms = validateComparison(report.release, report.analysis)
    report.status = 'passed'
  } catch (error) {
    report.error = errorMessage(error)
  } finally {
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    await rm(temporaryRoot, { recursive: true, force: true })
  }

  console.log(`Mobile bundle comparison: ${report.status} (${relative(repositoryRoot, reportPath)})`)
  if (report.status !== 'passed') throw new Error(report.error)
}

await runCli(main)

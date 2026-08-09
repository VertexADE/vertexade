#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { arch, platform as hostPlatform, release } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { findCrashLines, parseAndroidStartup, runCli, summarizeSamples } = require('./hermes-release-policy.cjs')

const [target, requestedOutput, mode = 'startup'] = process.argv.slice(2)
if (!['android', 'ios'].includes(target) || !['startup', 'crash-only'].includes(mode)) {
  console.error('Usage: device-runtime-probe.mjs <android|ios> [output.json] [startup|crash-only]')
  process.exit(2)
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const outputPath = resolve(
  process.cwd(),
  requestedOutput || `../../artifacts/mobile-device/runtime-${target}-${mode}.json`,
)
const appId = process.env.MAESTRO_APP_ID || 'com.vertexade.mobile'
const sampleCount = Number.parseInt(process.env.MOBILE_STARTUP_SAMPLES || '10', 10)

function command(program, arguments_, options = {}) {
  const result = spawnSync(program, arguments_, { encoding: 'utf8', ...options })
  assertCommandAvailable(program, result)
  assertCommandSucceeded(program, arguments_, result, options.allowFailure)
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}

function assertCommandAvailable(program, result) {
  if (result.error) throw new Error(`${program} is unavailable: ${result.error.message}`)
}

function assertCommandSucceeded(program, arguments_, result, allowFailure) {
  if (result.status === 0) return
  if (allowFailure) return
  throw new Error(`${program} ${arguments_.join(' ')} failed: ${commandFailure(result)}`)
}

function commandFailure(result) {
  return [result.stderr, result.stdout, `exit ${result.status}`].find(Boolean)
}

function androidDevice() {
  const properties = command('adb', ['shell', 'getprop']).stdout
  const property = (name) => properties.match(new RegExp(`\\[${name.replaceAll('.', '\\.')}\\]: \\[(.*?)\\]`))?.[1] || null
  return {
    model: property('ro.product.model'),
    os: property('ro.build.version.release'),
    api: property('ro.build.version.sdk'),
    abi: property('ro.product.cpu.abi'),
  }
}

function iosDevice() {
  const raw = command('xcrun', ['simctl', 'list', 'devices', 'booted', '--json']).stdout
  const devices = Object.values(JSON.parse(raw).devices || {}).flat()
  const device = devices.find((candidate) => candidate.state === 'Booted')
  if (!device) throw new Error('No booted iOS simulator is available')
  return { model: device.name, os: device.runtime || null, udid: device.udid, abi: arch() }
}

function clearLogs() {
  if (target === 'android') command('adb', ['logcat', '-c'])
  else command('xcrun', ['simctl', 'spawn', 'booted', 'log', 'erase'], { allowFailure: true })
}

function readLogs() {
  if (target === 'android') return command('adb', ['logcat', '-d', '-v', 'epoch']).stdout
  return command('xcrun', [
    'simctl',
    'spawn',
    'booted',
    'log',
    'show',
    '--last',
    '20m',
    '--style',
    'compact',
    '--predicate',
    `eventMessage CONTAINS[c] "${appId}" OR processImagePath CONTAINS[c] "${appId}"`,
  ]).stdout
}

function launchAndroid() {
  command('adb', ['shell', 'am', 'force-stop', appId])
  const output = command('adb', ['shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`]).stdout
  return { durationMs: parseAndroidStartup(output), raw: output.trim() }
}

function launchIos() {
  command('xcrun', ['simctl', 'terminate', 'booted', appId], { allowFailure: true })
  const started = performance.now()
  const output = command('xcrun', ['simctl', 'launch', '--terminate-running-process', 'booted', appId]).stdout
  return { durationMs: Math.round(performance.now() - started), raw: output.trim() }
}

const deviceReaders = { android: androidDevice, ios: iosDevice }
const launchers = { android: launchAndroid, ios: launchIos }

function initialReport() {
  return {
    schemaVersion: 1,
    status: 'failed',
    generatedAt: new Date().toISOString(),
    mode,
    target,
    appId,
    bytecodeMode: 'hermes',
    host: { platform: hostPlatform(), release: release(), architecture: arch() },
  }
}

function collectStartup(report) {
  if (mode !== 'startup') return
  clearLogs()
  const launch = launchers[target]
  report.warmup = launch()
  report.samples = Array.from({ length: sampleCount }, () => launch())
  report.summary = summarizeSamples(report.samples.map((sample) => sample.durationMs))
}

async function collectLogs(report, logPath) {
  const logs = readLogs()
  await writeFile(logPath, logs)
  report.logPath = logPath
  report.crashLines = findCrashLines(logs)
  report.status = report.crashLines.length === 0 ? 'passed' : 'failed'
  if (report.crashLines.length > 0) report.error = `${report.crashLines.length} fatal runtime log line(s) detected`
}

async function collectRuntime(report, logPath) {
  report.device = deviceReaders[target]()
  collectStartup(report)
  await collectLogs(report, logPath)
}

function assertSampleCount() {
  if (Number.isInteger(sampleCount) && sampleCount >= 10) return
  throw new Error('MOBILE_STARTUP_SAMPLES must be at least 10')
}

async function collectRuntimeSafely(report, logPath) {
  try {
    await collectRuntime(report, logPath)
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }
}

function assertProbePassed(report) {
  if (report.status === 'passed') return
  throw new Error(report.error)
}

async function main() {
  assertSampleCount()
  await mkdir(dirname(outputPath), { recursive: true })
  const logPath = outputPath.replace(/\.json$/i, '.log')
  const report = initialReport()
  await collectRuntimeSafely(report, logPath)
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Mobile ${target} ${mode} probe: ${report.status} (${outputPath.replace(`${repositoryRoot}/`, '')})`)
  assertProbePassed(report)
}

await runCli(main)

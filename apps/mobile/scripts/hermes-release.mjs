#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { parseElfArchitecture } = require('./hermes-release-policy.cjs')
const scriptPath = fileURLToPath(import.meta.url)
export const mobileRoot = resolve(dirname(scriptPath), '..')

function executableName() {
  if (platform() === 'darwin') return 'osx-bin/hermesc'
  if (platform() === 'linux') return 'linux64-bin/hermesc'
  if (platform() === 'win32') return 'win64-bin/hermesc.exe'
  throw new Error(`Hermes release export does not support host platform ${platform()}`)
}

async function findExecutable(name, environment = process.env) {
  for (const directory of (environment.PATH || '').split(':').filter(Boolean)) {
    const candidate = join(directory, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue to the next PATH entry.
    }
  }
  return null
}

function compilerPath() {
  const packagePath = require.resolve('hermes-compiler/package.json')
  return join(dirname(packagePath), 'hermesc', executableName())
}

async function createArm64LinuxBridge(compiler, environment) {
  const emulator = await requireArm64Emulator(environment)
  verifyEmulatedCompiler(emulator, compiler)

  const overrideRoot = await mkdtemp(join(tmpdir(), 'vertexade-hermes-arm64-'))
  const wrapper = join(overrideRoot, 'build/bin/hermesc')
  await mkdir(dirname(wrapper), { recursive: true })
  await writeFile(
    wrapper,
    [
      '#!/usr/bin/env node',
      "const { spawnSync } = require('node:child_process')",
      `const result = spawnSync(${JSON.stringify(emulator)}, [${JSON.stringify(compiler)}, ...process.argv.slice(2)], { stdio: 'inherit' })`,
      "if (result.error) { console.error(result.error.message); process.exit(1) }",
      'process.exit(result.status ?? 1)',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  await chmod(wrapper, 0o755)
  return {
    environment: { ...environment, REACT_NATIVE_OVERRIDE_HERMES_DIR: overrideRoot },
    mode: 'qemu-x86_64',
    cleanup: () => rm(overrideRoot, { recursive: true, force: true }),
  }
}

async function requireArm64Emulator(environment) {
  const emulator = await findExecutable('qemu-x86_64', environment)
  if (emulator) return emulator
  throw new Error(
    'Hermes release export needs qemu-x86_64 on ARM64 Linux because Expo supplies an x64 compiler. Install QEMU user emulation or run the release export on an x64 Linux/macOS build worker. export:analysis is non-releasable.',
  )
}

function verifyEmulatedCompiler(emulator, compiler) {
  const probe = spawnSync(emulator, [compiler, '-version'], { encoding: 'utf8' })
  if (probe.status === 0) return
  throw new Error(`qemu-x86_64 could not execute Expo's Hermes compiler: ${probe.stderr || probe.stdout || 'unknown error'}`)
}

function nativeCompiler(compiler, compilerArchitecture, environment) {
  return {
    compiler,
    compilerArchitecture,
    hostArchitecture: arch(),
    environment,
    mode: 'native',
    cleanup: async () => {},
  }
}

async function foreignCompiler(compiler, compilerArchitecture, environment) {
  if (arch() === 'arm64' && compilerArchitecture === 'x64') {
    const bridge = await createArm64LinuxBridge(compiler, environment)
    return { ...bridge, compiler, compilerArchitecture, hostArchitecture: arch() }
  }
  throw new Error(`Hermes compiler architecture ${compilerArchitecture} cannot run on ${arch()} Linux`)
}

function detectCompilerArchitecture(compilerHeader) {
  if (platform() !== 'linux') return null
  return parseElfArchitecture(compilerHeader)
}

function compilerNeedsBridge(compilerArchitecture) {
  if (!compilerArchitecture) return false
  return compilerArchitecture !== arch()
}

export async function prepareHermesCompiler(environment = process.env) {
  const compiler = compilerPath()
  const compilerHeader = await readFile(compiler).then((contents) => contents.subarray(0, 64))
  const compilerArchitecture = detectCompilerArchitecture(compilerHeader)
  if (compilerNeedsBridge(compilerArchitecture)) return foreignCompiler(compiler, compilerArchitecture, environment)
  return nativeCompiler(compiler, compilerArchitecture, environment)
}

export function runExpo(arguments_, { cwd = mobileRoot, environment = process.env, stdio = 'inherit' } = {}) {
  const expoPackage = require.resolve('expo/package.json')
  const expoCli = join(dirname(expoPackage), require(expoPackage).bin.expo)
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [expoCli, ...arguments_], { cwd, env: environment, stdio })
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise({ code, signal })
      else rejectPromise(Object.assign(new Error(`Expo ${arguments_[0] || 'command'} exited with ${signal || code}`), { code, signal }))
    })
  })
}

export async function runReleaseExport(arguments_ = [], options = {}) {
  if (arguments_.includes('--no-bytecode')) {
    throw new Error('Release export cannot disable Hermes bytecode; use export:analysis for non-releasable inspection')
  }
  const prepared = await prepareHermesCompiler(options.environment || process.env)
  if (prepared.mode !== 'native') {
    console.log(`Hermes compiler: ${prepared.mode} bridge (${prepared.compilerArchitecture} compiler on ${prepared.hostArchitecture})`)
  }
  try {
    return await runExpo(['export', ...arguments_], { ...options, environment: prepared.environment })
  } finally {
    await prepared.cleanup()
  }
}

if (resolve(process.argv[1] || '') === scriptPath) {
  try {
    await runReleaseExport(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

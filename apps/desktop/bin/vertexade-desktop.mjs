#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const packageRoot = new URL('..', import.meta.url)
const packageJson = await import(new URL('package.json', packageRoot), { with: { type: 'json' } })
const version = packageJson.default.version
const dataRoot = process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'vertex-ade') : join(homedir(), '.vertex-ade')
const installRoot = join(dataRoot, 'desktop', version)

function releaseAsset() {
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    return {
      name: `VertexADE-${version}-mac-${arch}.zip`,
      relativeExecutable: join('VertexADE.app', 'Contents', 'MacOS', 'vertexade'),
    }
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return { name: `VertexADE-${version}-win-x64.zip`, relativeExecutable: 'VertexADE.exe' }
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return {
      name: `VertexADE-${version}-linux-x86_64.AppImage`,
      relativeExecutable: `VertexADE-${version}.AppImage`,
    }
  }
  throw new Error(`No VertexADE desktop bundle is available for ${process.platform}/${process.arch}`)
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Could not download VertexADE (${response.status} ${response.statusText})`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

function extractZip(archive, destination) {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          ['-NoProfile', '-Command', 'Expand-Archive', '-LiteralPath', archive, '-DestinationPath', destination, '-Force'],
          { stdio: 'inherit' },
        )
      : spawnSync('ditto', ['-x', '-k', archive, destination], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Desktop bundle extraction failed (${result.status})`)
}

async function installBundle(asset) {
  await mkdir(dirname(installRoot), { recursive: true })
  const staging = `${installRoot}.installing-${process.pid}`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  const archive = join(staging, asset.name)
  const url = `https://github.com/VertexADE/vertexade/releases/download/v${version}/${asset.name}`
  console.error(`Installing VertexADE ${version} desktop bundle in ${installRoot}...`)
  await download(url, archive)

  if (asset.name.endsWith('.zip')) {
    extractZip(archive, staging)
    await rm(archive, { force: true })
  } else {
    const executable = join(staging, asset.relativeExecutable)
    await rename(archive, executable)
    await chmod(executable, 0o755)
  }

  await rm(installRoot, { recursive: true, force: true })
  await rename(staging, installRoot)
}

const asset = releaseAsset()
const executable = join(installRoot, asset.relativeExecutable)
if (!(await exists(executable))) await installBundle(asset)

const child = spawn(executable, process.argv.slice(2), { stdio: 'inherit' })
child.once('error', (error) => {
  throw error
})
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})

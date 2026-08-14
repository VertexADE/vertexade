#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serverArtifacts } from './artifacts.mjs'

const root = fileURLToPath(new URL('../dist', import.meta.url))
const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const vertexHome = process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'vertex-ade') : join(homedir(), '.vertex-ade')
const dataDirectory = resolve(process.env.VERTEXADE_DATA_DIR || vertexHome)
const runtimeConfigurationPath = resolve(process.env.VERTEXADE_SERVER_CONFIG_PATH || join(dataDirectory, 'server-runtime.json'))
const runtimeConfiguration = await readRuntimeConfiguration(runtimeConfigurationPath)
const api = listener('API', 'API_HOST', 'API_PORT', runtimeConfiguration.api, { host: '127.0.0.1', port: 4174 })
const web = listener('Web', 'HOST', 'PORT', runtimeConfiguration.web, { host: '127.0.0.1', port: 4173 })
if (api.port === web.port) throw new Error('Web and API listeners must use different ports')
const apiPort = String(api.port)
const webPort = String(web.port)
const children = [
  spawn(process.execPath, [join(root, serverArtifacts.api)], {
    env: {
      ...process.env,
      APP_ROOT: join(root, 'runtime'),
      API_HOST: api.host,
      API_PORT: apiPort,
      VERTEXADE_API_LISTENER_SOURCE: api.source,
      VERTEXADE_WEB_CURRENT_HOST: web.host,
      VERTEXADE_WEB_CURRENT_PORT: webPort,
      VERTEXADE_WEB_LISTENER_SOURCE: web.source,
      VERTEXADE_SERVER_CONFIG_PATH: runtimeConfigurationPath,
      VERTEXADE_DATA_DIR: dataDirectory,
      VERTEXADE_INSTALLATION: process.env.VERTEXADE_INSTALLATION || 'npm',
      VERTEXADE_SUBAGENT_MCP_SCRIPT: process.env.VERTEXADE_SUBAGENT_MCP_SCRIPT || join(root, serverArtifacts.subagentMcp),
      VERTEXADE_VERSION: process.env.VERTEXADE_VERSION || String(packageMetadata.version || 'unknown'),
      VERTEXADE_WORKTREE_ROOT: process.env.VERTEXADE_WORKTREE_ROOT || join(vertexHome, 'worktrees'),
    },
    stdio: 'inherit',
  }),
  spawn(process.execPath, [join(root, serverArtifacts.web, 'server/index.mjs')], {
    env: {
      ...process.env,
      HOST: web.host,
      PORT: webPort,
      VERTEXADE_API_URL: process.env.VERTEXADE_API_URL || `http://${internalHost(api.host)}:${apiPort}`,
      VERTEXADE_INSTALLATION: process.env.VERTEXADE_INSTALLATION || 'npm',
      VERTEXADE_VERSION: process.env.VERTEXADE_VERSION || String(packageMetadata.version || 'unknown'),
    },
    stdio: 'inherit',
  }),
]

async function readRuntimeConfiguration(path) {
  try {
    return configurationObject(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw new Error(`Could not read server runtime configuration at ${path}: ${errorMessage(error)}`, { cause: error })
  }
}

function listener(label, hostVariable, portVariable, configured, fallback) {
  const environmentHost = process.env[hostVariable]
  const environmentPort = process.env[portVariable]
  return {
    host: checkedHost(selectedValue(environmentHost, configured?.host, fallback.host), label),
    port: checkedPort(selectedValue(environmentPort, configured?.port, fallback.port), label),
    source: listenerSource(environmentHost, environmentPort, configured),
  }
}

function configurationObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Server runtime configuration must be an object')
  return value
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function selectedValue(environmentValue, configuredValue, fallback) {
  if (environmentValue !== undefined) return environmentValue
  if (configuredValue !== undefined) return configuredValue
  return fallback
}

function listenerSource(environmentHost, environmentPort, configured) {
  if (environmentHost !== undefined || environmentPort !== undefined) return 'environment'
  return configured ? 'settings' : 'default'
}

function checkedHost(value, label) {
  const host = String(value || '')
    .trim()
    .toLowerCase()
  if (!validHost(host)) {
    throw new Error(`${label} host must be an IP address or hostname without a protocol or port`)
  }
  return host
}

function validHost(host) {
  const hostname = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i
  return Boolean(host && (isIP(host) || host === 'localhost' || hostname.test(host)))
}

function checkedPort(value, label) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${label} port must be an integer from 1 to 65535`)
  return port
}

function internalHost(host) {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::') return '[::1]'
  return isIP(host) === 6 ? `[${host}]` : host
}

let stopping = false
function stop(signal) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill(signal)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(signal))
for (const child of children) {
  child.once('exit', (code) => {
    if (!stopping) {
      process.exitCode = code ?? 1
      stop('SIGTERM')
    }
  })
}

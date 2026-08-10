import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { vertexDataDirectory } from './configuration.ts'

export type ListenerAddress = {
  host: string
  port: number
}

export type ServerListenerConfiguration = {
  web: ListenerAddress
  api: ListenerAddress
}

export const defaultServerListenerConfiguration: ServerListenerConfiguration = {
  web: { host: '127.0.0.1', port: 4173 },
  api: { host: '127.0.0.1', port: 4174 },
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function listenerHost(value: unknown, label: string) {
  const host = String(value || '').trim()
  const hostname = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i
  if (!host || (!isIP(host) && host !== 'localhost' && !hostname.test(host))) {
    throw new Error(`${label} host must be an IP address or hostname without a protocol or port`)
  }
  return host.toLowerCase()
}

function listenerPort(value: unknown, label: string) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${label} port must be an integer from 1 to 65535`)
  return port
}

function listener(value: unknown, label: string, fallback: ListenerAddress): ListenerAddress {
  if (!record(value)) throw new Error(`${label} listener must be an object`)
  for (const key of Object.keys(value))
    if (!['host', 'port'].includes(key)) throw new Error(`Unknown ${label.toLowerCase()} listener setting: ${key}`)
  return {
    host: listenerHost(value.host ?? fallback.host, label),
    port: listenerPort(value.port ?? fallback.port, label),
  }
}

export function normalizeServerListenerConfiguration(
  value: unknown,
  fallback: ServerListenerConfiguration = defaultServerListenerConfiguration,
): ServerListenerConfiguration {
  if (!record(value)) throw new Error('Server listener configuration must be an object')
  for (const key of Object.keys(value)) if (!['web', 'api'].includes(key)) throw new Error(`Unknown server listener: ${key}`)
  const configuration = {
    web: listener(value.web ?? fallback.web, 'Web', fallback.web),
    api: listener(value.api ?? fallback.api, 'API', fallback.api),
  }
  if (configuration.web.port === configuration.api.port) throw new Error('Web and API listeners must use different ports')
  return configuration
}

export function serverListenerConfigurationPath(environment: NodeJS.ProcessEnv = process.env) {
  return environment.VERTEXADE_SERVER_CONFIG_PATH
    ? resolve(environment.VERTEXADE_SERVER_CONFIG_PATH)
    : join(vertexDataDirectory(environment), 'server-runtime.json')
}

export async function readServerListenerConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  try {
    const value = JSON.parse(await readFile(serverListenerConfigurationPath(environment), 'utf8')) as unknown
    return normalizeServerListenerConfiguration(value)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultServerListenerConfiguration
    throw error
  }
}

export async function writeServerListenerConfiguration(value: unknown, environment: NodeJS.ProcessEnv = process.env) {
  const configuration = normalizeServerListenerConfiguration(value)
  const path = serverListenerConfigurationPath(environment)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(configuration, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
  return configuration
}

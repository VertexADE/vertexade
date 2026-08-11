import {
  readServerListenerConfiguration,
  normalizeServerListenerConfiguration,
  writeServerListenerConfiguration,
  type ListenerAddress,
} from '@vertexade/platform-server/listener-configuration'
import { networkInterfaces } from 'node:os'
import { isIP } from 'node:net'

export type ListenerConfigurationStatus = ListenerAddress & {
  currentHost: string
  currentPort: number
  source: 'environment' | 'settings' | 'default'
  environmentOverride: boolean
}

export type ServerRuntimeStatus = {
  web: ListenerConfigurationStatus
  api: ListenerConfigurationStatus
  webOrigins: string[]
  restartRequired: boolean
}

type HostInterfaces = ReturnType<typeof networkInterfaces>

function listenerOrigin(host: string, port: number): string {
  return `http://${isIP(host) === 6 ? `[${host}]` : host}:${port}`
}

export function webListenerOrigins(listener: ListenerAddress, interfaces: HostInterfaces = networkInterfaces()): string[] {
  if (listener.host !== '0.0.0.0' && listener.host !== '::') {
    return ['127.0.0.1', '::1', 'localhost'].includes(listener.host) ? [] : [listenerOrigin(listener.host, listener.port)]
  }
  const origins = Object.values(interfaces)
    .flatMap((entries) => entries || [])
    .filter((entry) => !entry.internal && !entry.address.includes('%'))
    .map((entry) => listenerOrigin(entry.address, listener.port))
  return [...new Set(origins)].sort()
}

function source(value: string | undefined, explicitlyConfigured: boolean): ListenerConfigurationStatus['source'] {
  return value === 'environment' || value === 'settings' || value === 'default' ? value : explicitlyConfigured ? 'environment' : 'default'
}

function status(
  configured: ListenerAddress,
  current: ListenerAddress,
  configuredSource: ListenerConfigurationStatus['source'],
): ListenerConfigurationStatus {
  return {
    ...configured,
    currentHost: current.host,
    currentPort: current.port,
    source: configuredSource,
    environmentOverride: configuredSource === 'environment',
  }
}

export async function serverRuntimeStatus(environment: NodeJS.ProcessEnv = process.env): Promise<ServerRuntimeStatus> {
  const configured = await readServerListenerConfiguration(environment)
  const currentWeb = {
    host: environment.VERTEXADE_WEB_CURRENT_HOST || environment.HOST || '127.0.0.1',
    port: Number(environment.VERTEXADE_WEB_CURRENT_PORT || environment.PORT || 4173),
  }
  const currentApi = {
    host: environment.API_HOST || '127.0.0.1',
    port: Number(environment.API_PORT || 4174),
  }
  const web = status(configured.web, currentWeb, source(environment.VERTEXADE_WEB_LISTENER_SOURCE, environment.HOST !== undefined))
  const api = status(configured.api, currentApi, source(environment.VERTEXADE_API_LISTENER_SOURCE, environment.API_HOST !== undefined))
  return {
    web,
    api,
    webOrigins: webListenerOrigins(currentWeb),
    restartRequired:
      (!web.environmentOverride && (web.host !== web.currentHost || web.port !== web.currentPort)) ||
      (!api.environmentOverride && (api.host !== api.currentHost || api.port !== api.currentPort)),
  }
}

export async function updateServerRuntimeConfiguration(input: unknown, environment: NodeJS.ProcessEnv = process.env) {
  const configuration = normalizeServerListenerConfiguration(input)
  if (environment.VERTEXADE_BUNDLED_RUNTIME === '1' && !['127.0.0.1', '::1', 'localhost'].includes(configuration.api.host)) {
    throw new Error('VertexADE Desktop keeps the API listener on loopback. Expose the authenticated web listener for phone access.')
  }
  await writeServerListenerConfiguration(configuration, environment)
  return serverRuntimeStatus(environment)
}

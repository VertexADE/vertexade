import {
  readServerListenerConfiguration,
  writeServerListenerConfiguration,
  type ListenerAddress,
} from '@vertexade/platform-server/listener-configuration'

export type ListenerConfigurationStatus = ListenerAddress & {
  currentHost: string
  currentPort: number
  source: 'environment' | 'settings' | 'default'
  environmentOverride: boolean
}

export type ServerRuntimeStatus = {
  web: ListenerConfigurationStatus
  api: ListenerConfigurationStatus
  restartRequired: boolean
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
    restartRequired:
      (!web.environmentOverride && (web.host !== web.currentHost || web.port !== web.currentPort)) ||
      (!api.environmentOverride && (api.host !== api.currentHost || api.port !== api.currentPort)),
  }
}

export async function updateServerRuntimeConfiguration(input: unknown, environment: NodeJS.ProcessEnv = process.env) {
  await writeServerListenerConfiguration(input, environment)
  return serverRuntimeStatus(environment)
}

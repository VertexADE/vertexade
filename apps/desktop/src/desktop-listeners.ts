import { access } from 'node:fs/promises'
import { isIP } from 'node:net'
import {
  readServerListenerConfiguration,
  serverListenerConfigurationPath,
  type ListenerAddress,
} from '@vertexade/platform-server/listener-configuration'

export type DesktopListenerSelection = {
  api: ListenerAddress
  web: ListenerAddress
  source: 'default' | 'settings'
}

type PortAllocator = () => Promise<number>
type ConfigurationReader = (environment: NodeJS.ProcessEnv) => ReturnType<typeof readServerListenerConfiguration>

async function configurationExists(environment: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    await access(serverListenerConfigurationPath(environment))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function selectDesktopListeners(
  environment: NodeJS.ProcessEnv,
  allocatePort: PortAllocator,
  hasConfiguration: (environment: NodeJS.ProcessEnv) => Promise<boolean> = configurationExists,
  readConfiguration: ConfigurationReader = readServerListenerConfiguration,
): Promise<DesktopListenerSelection> {
  if (await hasConfiguration(environment)) {
    const configured = await readConfiguration(environment)
    return { ...configured, source: 'settings' }
  }

  const apiPort = await allocatePort()
  let webPort = await allocatePort()
  while (webPort === apiPort) webPort = await allocatePort()
  return {
    api: { host: '127.0.0.1', port: apiPort },
    web: { host: '127.0.0.1', port: webPort },
    source: 'default',
  }
}

export function localListenerUrl(listener: ListenerAddress): string {
  const host = listener.host === '0.0.0.0' ? '127.0.0.1' : listener.host === '::' ? '::1' : listener.host
  const hostname = isIP(host) === 6 ? `[${host}]` : host
  return `http://${hostname}:${listener.port}`
}

import { createConnection } from 'node:net'
import { resilientFetch } from '@vertexade/platform-server/effect'
import { previewServiceSlug, type PreviewPlan, type PreviewServicePlan } from './detect.ts'

function containerPorts(inspect: Record<string, any>) {
  return Object.entries<any>(inspect.NetworkSettings?.Ports || {}).flatMap(([key, bindings]) => {
    const [rawPort, protocolValue] = key.split('/')
    const containerPort = Number(rawPort)
    const protocol = protocolValue === 'udp' ? ('udp' as const) : ('tcp' as const)
    if (!Number.isInteger(containerPort) || !Array.isArray(bindings)) return []
    return bindings.flatMap((binding) => {
      const hostPort = Number(binding?.HostPort)
      return Number.isInteger(hostPort) ? [{ containerPort, hostPort, protocol }] : []
    })
  })
}

export type PreviewPublishedPort = {
  containerPort: number
  hostPort: number
  protocol: 'tcp' | 'udp'
  hostname: string
  url: string | null
}

export type PreviewService = {
  name: string
  containerId: string
  containerName: string
  status: string
  ports: PreviewPublishedPort[]
  source?: PreviewServicePlan['source']
  project?: string
  task?: string
  environmentScope?: string
  stopCommand?: string
}

export function plannedTcpService(service: PreviewServicePlan) {
  return service.ports.some((port) => port.protocol === 'tcp')
}

export function publishedTcpServiceReady(service: PreviewService | undefined) {
  return Boolean(service?.status === 'running' && service.ports.some((port) => port.protocol === 'tcp'))
}

function inspectServiceReady(container: Record<string, any> | undefined) {
  if (container?.State?.Status !== 'running') return false
  const health = container.State?.Health?.Status
  return health !== 'unhealthy'
}

function reachableTcpPort(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (ready: boolean) => {
      socket.destroy()
      resolve(ready)
    }
    socket.setTimeout(750, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function reachableHttpPort(port: number) {
  try {
    await resilientFetch({
      service: 'Worktree preview',
      fetch: globalThis.fetch,
      url: `http://127.0.0.1:${port}/`,
      init: { redirect: 'manual' },
      timeoutMs: 1_500,
      attempts: 1,
    })
    return true
  } catch {
    return false
  }
}

export async function inspectServiceReadyAndReachable(container: Record<string, any> | undefined, planned: PreviewServicePlan) {
  if (!inspectServiceReady(container)) return false
  const ports = containerPorts(container!).filter((port) => port.protocol === 'tcp')
  if (!ports.length) return false
  const publicPorts = new Set(
    planned.ports.filter((port) => port.protocol === 'tcp' && port.public !== false).map((port) => port.containerPort),
  )
  return (
    await Promise.all(
      ports.map((port) => (publicPorts.has(port.containerPort) ? reachableHttpPort(port.hostPort) : reachableTcpPort(port.hostPort))),
    )
  ).some(Boolean)
}

export function unavailablePreviewServices(plan: PreviewPlan, services: PreviewService[]) {
  return plan.services
    .filter(plannedTcpService)
    .map((planned) => {
      const name = previewServiceSlug(planned.runtimeName)
      return (
        services.find((service) => service.name === name) || {
          name,
          containerId: '',
          containerName: '',
          status: 'missing',
          ports: [],
        }
      )
    })
    .filter((service) => !publishedTcpServiceReady(service))
}

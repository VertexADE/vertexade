import type { DeploymentOverview, DeploymentService, DeploymentTarget } from '@vertexade/ui/lib/dashboard-types'
import type { BackendDescriptor } from '@vertexade/ui/lib/backend-registry'

export type NormalizedDeploymentOverview = DeploymentOverview & {
  provider: { id: string; name: string }
}

export type RoutedDeploymentPayload = Omit<NormalizedDeploymentOverview, 'services' | 'targets'> & {
  services: Array<Omit<DeploymentService, 'key' | 'target'> & { key?: string; target?: DeploymentTarget }>
  targets?: DeploymentTarget[]
}

export type RoutedDeploymentTarget = DeploymentTarget & {
  backend_id: string
  backend_name: string
  backend_target_id: string
}

export type RoutedDeploymentService = Omit<DeploymentService, 'target'> & {
  backend_id: string
  backend_name: string
  provider_id: string
  target: RoutedDeploymentTarget
}

export type RoutedDeploymentOverview = Omit<NormalizedDeploymentOverview, 'services' | 'targets'> & {
  backends: Array<Pick<BackendDescriptor, 'id' | 'label'>>
  services: RoutedDeploymentService[]
  targets: RoutedDeploymentTarget[]
}

function legacyDeploymentTarget(payload: RoutedDeploymentPayload): DeploymentTarget {
  const discovered = [...new Set(payload.services.flatMap((service) => Object.keys(service.environments)))]
  const environments = discovered.length ? discovered : ['dev', 'acc', 'prd']
  return {
    id: 'legacy',
    label: payload.repository,
    repository: payload.repository,
    workflow: payload.workflow,
    branch: 'main',
    event: 'push',
    environments,
    production_environment: environments.includes('prd') ? 'prd' : environments.at(-1)!,
    comparison_environment: environments.includes('dev') ? 'dev' : environments[0]!,
  }
}

export function normalizeDeploymentOverview(payload: RoutedDeploymentPayload): NormalizedDeploymentOverview {
  const fallback = legacyDeploymentTarget(payload)
  const targets = payload.targets || [fallback]
  const defaultTarget = targets[0] || fallback
  return {
    ...payload,
    targets,
    services: payload.services.map((service) => {
      const target = service.target || defaultTarget
      return { ...service, target, key: service.key || `${target.id}:${service.name}` }
    }),
  }
}

export function routeDeploymentOverview(payload: RoutedDeploymentPayload, backend: BackendDescriptor): RoutedDeploymentOverview {
  const overview = normalizeDeploymentOverview(payload)
  const targets = overview.targets.map(
    (target): RoutedDeploymentTarget => ({
      ...target,
      id: `${backend.id}:${target.id}`,
      label: `${backend.label} · ${target.label}`,
      backend_id: backend.id,
      backend_name: backend.label,
      backend_target_id: target.id,
    }),
  )
  const targetsByLocalId = new Map(targets.map((target) => [target.backend_target_id, target]))
  return {
    ...overview,
    backends: [{ id: backend.id, label: backend.label }],
    targets,
    services: overview.services.map((service): RoutedDeploymentService => {
      const target = targetsByLocalId.get(service.target.id)
      if (!target) throw new Error(`Deployment target ${service.target.id} is missing on ${backend.label}`)
      return {
        ...service,
        key: `${backend.id}:${service.key}`,
        backend_id: backend.id,
        backend_name: backend.label,
        provider_id: overview.provider.id,
        target,
      }
    }),
  }
}

export function mergeDeploymentOverviews(overviews: RoutedDeploymentOverview[]): RoutedDeploymentOverview | null {
  if (!overviews.length) return null
  const targets = overviews.flatMap((overview) => overview.targets)
  const services = overviews.flatMap((overview) => overview.services)
  const providers = [...new Map(overviews.map((overview) => [overview.provider.id, overview.provider])).values()]
  const repositories = new Set(targets.map((target) => target.repository))
  const workflows = new Set(targets.map((target) => target.workflow))
  return {
    repository: repositories.size === 1 ? [...repositories][0]! : `${repositories.size} configured repositories`,
    workflow: workflows.size === 1 ? [...workflows][0]! : `${workflows.size} configured workflows`,
    refreshed_at:
      overviews
        .map((overview) => overview.refreshed_at)
        .sort()
        .at(-1) || new Date(0).toISOString(),
    provider: providers.length === 1 ? providers[0]! : { id: 'federated', name: providers.map((provider) => provider.name).join(', ') },
    backends: overviews.flatMap((overview) => overview.backends),
    targets,
    services,
    summary: {
      deployed: overviews.reduce((total, overview) => total + overview.summary.deployed, 0),
      attention: overviews.reduce((total, overview) => total + overview.summary.attention, 0),
      active: overviews.reduce((total, overview) => total + overview.summary.active, 0),
      pending_commits: overviews.reduce((total, overview) => total + overview.summary.pending_commits, 0),
    },
  }
}

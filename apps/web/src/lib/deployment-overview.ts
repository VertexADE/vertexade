import type { DeploymentOverview, DeploymentService, DeploymentTarget } from '@vertexade/ui/lib/dashboard-types'

export type RoutedDeploymentOverview = DeploymentOverview & {
  provider: { id: string; name: string }
}

export type RoutedDeploymentPayload = Omit<RoutedDeploymentOverview, 'services' | 'targets'> & {
  services: Array<Omit<DeploymentService, 'key' | 'target'> & { key?: string; target?: DeploymentTarget }>
  targets?: DeploymentTarget[]
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

export function normalizeDeploymentOverview(payload: RoutedDeploymentPayload): RoutedDeploymentOverview {
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

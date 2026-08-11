import { describe, expect, it } from 'vite-plus/test'
import {
  mergeDeploymentOverviews,
  normalizeDeploymentOverview,
  routeDeploymentOverview,
  type RoutedDeploymentPayload,
} from './deployment-overview.ts'
import type { BackendDescriptor } from '@vertexade/ui/lib/backend-registry'

function payload(): RoutedDeploymentPayload {
  return {
    repository: 'acme/platform',
    workflow: 'deploy.yml',
    refreshed_at: '2026-08-10T12:00:00Z',
    provider: { id: 'github-actions', name: 'GitHub Actions' },
    summary: { deployed: 1, attention: 0, active: 0, pending_commits: 0 },
    services: [
      {
        name: 'api',
        state: 'deployed',
        latest: null,
        environments: { dev: null, prd: null },
        production_outdated: false,
        deployment_delta: null,
        pending_commits: [],
      },
    ],
  }
}

describe('deployment overview compatibility', () => {
  it('attributes legacy services to a derived target during a rolling server upgrade', () => {
    const overview = normalizeDeploymentOverview(payload())

    expect(overview.targets).toEqual([expect.objectContaining({ id: 'legacy', repository: 'acme/platform', environments: ['dev', 'prd'] })])
    expect(overview.services[0]).toMatchObject({ key: 'legacy:api', target: { id: 'legacy' } })
  })

  it('retains an intentionally empty target list', () => {
    expect(normalizeDeploymentOverview({ ...payload(), targets: [], services: [] }).targets).toEqual([])
  })

  it('namespaces targets and services by their owning backend', () => {
    const backend = { id: 'team', label: 'Team server' } as BackendDescriptor
    const overview = routeDeploymentOverview(payload(), backend)

    expect(overview.targets[0]).toMatchObject({ id: 'team:legacy', backend_id: 'team', backend_target_id: 'legacy' })
    expect(overview.services[0]).toMatchObject({
      key: 'team:legacy:api',
      backend_id: 'team',
      provider_id: 'github-actions',
      target: { id: 'team:legacy' },
    })
  })

  it('merges independently routed server overviews', () => {
    const first = routeDeploymentOverview(payload(), { id: 'one', label: 'One' } as BackendDescriptor)
    const second = routeDeploymentOverview({ ...payload(), summary: { deployed: 0, attention: 1, active: 0, pending_commits: 2 } }, {
      id: 'two',
      label: 'Two',
    } as BackendDescriptor)

    expect(mergeDeploymentOverviews([first, second])).toMatchObject({
      backends: [{ id: 'one' }, { id: 'two' }],
      summary: { deployed: 1, attention: 1, active: 0, pending_commits: 2 },
    })
    expect(mergeDeploymentOverviews([first, second])?.services.map((service) => service.key)).toEqual(['one:legacy:api', 'two:legacy:api'])
  })
})

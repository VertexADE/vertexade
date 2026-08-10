import { describe, expect, it } from 'vite-plus/test'
import { normalizeDeploymentOverview, type RoutedDeploymentPayload } from './deployment-overview.ts'

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
})

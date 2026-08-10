import { describe, expect, it } from 'vite-plus/test'
import type { DashboardData, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import { defaultPullRequestExecutionTarget, pullRequestExecutionTargets } from './pull-request-execution-target'

describe('pull request execution targets', () => {
  it('offers connected servers with the same repository and prefers the PR source', () => {
    const pr = { full_name: 'Acme/App', backend_id: 'source' } as PullRequest
    const data = {
      repositories: [
        { id: 1, backend_id: 'source', backend_local_id: 1, full_name: 'acme/app' },
        { id: 2_000_000_009, backend_id: 'worker', backend_local_id: 9, full_name: 'Acme/App' },
        { id: 3_000_000_004, backend_id: 'offline', backend_local_id: 4, full_name: 'Acme/App' },
        { id: 2_000_000_010, backend_id: 'worker', backend_local_id: 10, full_name: 'Acme/Other' },
      ],
      backends: [
        { id: 'worker', label: 'Worker', connected: true },
        { id: 'source', label: 'Source', connected: true },
        { id: 'offline', label: 'Offline', connected: false },
      ],
    } as DashboardData

    const targets = pullRequestExecutionTargets(pr, data)
    expect(targets.map((target) => [target.backend.id, target.repositoryId])).toEqual([
      ['source', 1],
      ['worker', 9],
    ])
    expect(defaultPullRequestExecutionTarget(pr, targets)?.backend.id).toBe('source')
  })
})

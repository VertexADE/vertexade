import { describe, expect, it } from 'vite-plus/test'
import type { WorkDeletionPreview } from '@vertexade/ui/lib/dashboard-types'
import { batchDeleteConfirmation, summarizeBatchDeletion } from './work-batch-delete'

function preview(overrides: Partial<WorkDeletionPreview> = {}): WorkDeletionPreview {
  return {
    work_item: { id: 1, key: 'W-0001', title: 'One' },
    threads: { total: 2, active: 1 },
    worktrees: [
      { path: '/one', repository: 'example/one', removable: true, reason: null },
      { path: '/shared', repository: 'example/shared', removable: false, reason: 'Used by another Work item' },
    ],
    local_branches: [{ repository: 'example/one', branch: 'feature/one', removable: true, reason: null }],
    logs: 2,
    logs_retained: 0,
    memory_file: true,
    preserved_pull_requests: [{ label: 'PR #1', url: 'https://example.test/1', state: 'merged' }],
    preserves: { repositories: true, pull_requests: true, remote_branches: true },
    ...overrides,
  }
}

describe('batch Work deletion summary', () => {
  it('aggregates removable impact while keeping shared assets and PRs visible', () => {
    const totals = summarizeBatchDeletion([
      preview(),
      preview({
        work_item: { id: 2, key: 'W-0002', title: 'Two' },
        threads: { total: 1, active: 0 },
        worktrees: [],
        local_branches: [{ repository: 'example/two', branch: 'feature/two', removable: false, reason: 'Shared' }],
        logs: 0,
        logs_retained: 1,
        memory_file: false,
      }),
    ])

    expect(totals).toMatchObject({
      items: 2,
      threads: 3,
      activeThreads: 1,
      worktrees: 1,
      retainedWorktrees: 1,
      branches: 1,
      retainedBranches: 1,
      logs: 2,
      retainedLogs: 1,
      memories: 1,
    })
    expect(totals.preservedPullRequests).toHaveLength(1)
  })

  it('uses the selected count in the explicit confirmation phrase', () => {
    expect(batchDeleteConfirmation(12)).toBe('DELETE 12')
  })
})

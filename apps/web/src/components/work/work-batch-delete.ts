import type { WorkDeletionPreview } from '@vertexade/ui/lib/dashboard-types'

export function batchDeleteConfirmation(count: number) {
  return `DELETE ${count}`
}

export function summarizeBatchDeletion(previews: WorkDeletionPreview[]) {
  const preserved = new Map<string, WorkDeletionPreview['preserved_pull_requests'][number]>()
  const totals = {
    items: previews.length,
    threads: 0,
    activeThreads: 0,
    worktrees: 0,
    retainedWorktrees: 0,
    branches: 0,
    retainedBranches: 0,
    logs: 0,
    retainedLogs: 0,
    memories: 0,
    preservedPullRequests: [] as WorkDeletionPreview['preserved_pull_requests'],
  }
  for (const preview of previews) {
    totals.threads += preview.threads.total
    totals.activeThreads += preview.threads.active
    totals.worktrees += preview.worktrees.filter((entry) => entry.removable).length
    totals.retainedWorktrees += preview.worktrees.filter((entry) => !entry.removable).length
    totals.branches += preview.local_branches.filter((entry) => entry.removable).length
    totals.retainedBranches += preview.local_branches.filter((entry) => !entry.removable).length
    totals.logs += preview.logs
    totals.retainedLogs += preview.logs_retained
    totals.memories += Number(preview.memory_file)
    for (const pullRequest of preview.preserved_pull_requests) {
      preserved.set(pullRequest.url || `${pullRequest.label}\0${pullRequest.state || ''}`, pullRequest)
    }
  }
  totals.preservedPullRequests = [...preserved.values()]
  return totals
}

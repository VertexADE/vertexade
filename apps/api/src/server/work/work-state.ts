export const workStates = ['backlog', 'active', 'review', 'deploy', 'done'] as const

export type WorkState = (typeof workStates)[number]

function choice(value: unknown, fallback: WorkState): WorkState {
  return workStates.includes(value as WorkState) ? (value as WorkState) : fallback
}

function reviewWorkState(jobs: any[], pullRequests: any[]): WorkState {
  const currentHead = String(pullRequests[0]?.metadata?.headSha || '')
  const completedReview = jobs.find((job) => job.kind === 'review' && job.status === 'completed')
  const changedAfterReview = completedReview && currentHead && completedReview.head_sha && completedReview.head_sha !== currentHead
  if (changedAfterReview) return 'review'
  if (pullRequests.length > 0 && pullRequests.every((resource) => ['approved', 'merged', 'closed'].includes(resource.state))) return 'done'
  return completedReview ? 'review' : 'backlog'
}

function deliveryWorkState(item: any, jobs: any[], resources: any[], pullRequests: any[]): WorkState {
  const scopedRepositoryIds = new Set(
    resources.filter((resource) => resource.kind === 'repository' && resource.repository_id).map((resource) => resource.repository_id),
  )
  const mergedPullRequests = pullRequests.filter((resource) => resource.state === 'merged')
  const mergedRepositoryIds = new Set(
    mergedPullRequests.filter((resource) => resource.repository_id).map((resource) => resource.repository_id),
  )
  const allScopedRepositoriesMerged =
    scopedRepositoryIds.size === 0 || [...scopedRepositoryIds].every((repositoryId) => mergedRepositoryIds.has(repositoryId))
  if (pullRequests.length > 0 && mergedPullRequests.length === pullRequests.length && allScopedRepositoriesMerged) {
    const deployments = resources.filter((resource) => resource.kind === 'deployment')
    const deployed = new Set(['deployed', 'success', 'succeeded', 'completed'])
    if (deployments.some((resource) => !deployed.has(resource.state))) return 'deploy'
    return 'done'
  }
  if (pullRequests.length > 0) return 'review'
  if (jobs.some((job) => job.status === 'completed')) return 'active'
  return choice(item.state, 'backlog')
}

export function projectedWorkState(item: any, jobs: any[], resources: any[]): WorkState {
  if (item.state_override) return choice(item.state_override, 'backlog')
  const deliveryJobs = jobs.filter((job) => job.kind !== 'work_review')
  if (deliveryJobs.some((job) => ['starting', 'running', 'resumable'].includes(job.status))) return 'active'
  const pullRequests = resources.filter((resource) => resource.kind === 'pull_request' && resource.role !== 'context')
  return item.kind === 'pr_review'
    ? reviewWorkState(deliveryJobs, pullRequests)
    : deliveryWorkState(item, deliveryJobs, resources, pullRequests)
}

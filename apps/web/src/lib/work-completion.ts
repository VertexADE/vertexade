import { agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import type { WorkItem, WorkState } from '@vertexade/ui/lib/dashboard-types'

const finishedReviewStates = new Set(['approved', 'merged', 'closed'])
const finishedDeliveryStates = new Set(['merged', 'closed'])
const finishedDeploymentStates = new Set(['deployed', 'success', 'succeeded', 'completed'])

export function workCompletionBlocker(item: WorkItem) {
  const activeRun = item.threads.find(
    (job) => ['starting', 'running', 'waiting'].includes(agentThreadState(job)) || job.status === 'queued',
  )
  if (activeRun) return 'This outcome will finish after its active agent run completes.'

  const pullRequests = item.resources.filter((resource) => resource.kind === 'pull_request' && resource.role !== 'context')
  if (item.kind === 'pr_review' && pullRequests.some((resource) => !finishedReviewStates.has(resource.state || '')))
    return 'This review will finish automatically after the pull request is approved, merged, or closed.'
  if (item.kind !== 'pr_review' && pullRequests.some((resource) => !finishedDeliveryStates.has(resource.state || '')))
    return 'This outcome will finish automatically after every delivery pull request is merged or closed.'

  const deployments = item.resources.filter((resource) => resource.kind === 'deployment')
  if (deployments.some((resource) => !finishedDeploymentStates.has(resource.state || '')))
    return 'This outcome will finish automatically after its tracked deployment succeeds.'

  return null
}

export function preventBlockedWorkCompletion(item: WorkItem, state: WorkState, notify: (message: string) => void) {
  const blocker = state === 'done' ? workCompletionBlocker(item) : null
  if (!blocker) return false
  notify(blocker)
  return true
}

import type { Job, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import { pullRequestSummaryFlow, type PullRequestFlowIntent, type PullRequestIdentity } from '@vertexade/ui/lib/pull-request-flow'

export type PullRequestActionId = 'ready' | 'work' | 'update' | 'review' | 'details' | 'merge'

export type PullRequestActionRecommendation = {
  id: PullRequestActionId
  label: string
  disabled?: boolean
}

export type PullRequestActionBusyState = {
  markingReady: boolean
  updating: boolean
  enablingAutoMerge: boolean
}

export type PullRequestActionContext = {
  identity?: PullRequestIdentity
  threads?: Job[]
}

export type PullRequestQueueGroupId = 'action' | 'review' | 'ship' | 'waiting'

function legacyActionId(intent: PullRequestFlowIntent): PullRequestActionId {
  if (intent === 'mark-ready') return 'ready'
  if (intent === 'fix-with-agent') return 'work'
  if (intent === 'update-branch') return 'update'
  if (intent === 'review-with-agent') return 'review'
  if (intent === 'enable-auto-merge') return 'merge'
  return 'details'
}

export function recommendedPullRequestAction(
  pullRequest: PullRequest,
  busy: PullRequestActionBusyState,
  context: PullRequestActionContext = {},
): PullRequestActionRecommendation {
  const flow = pullRequestSummaryFlow(pullRequest, context.identity || { status: 'unavailable' }, context.threads)
  const id = legacyActionId(flow.intent)
  const disabled = id === 'ready' ? busy.markingReady : id === 'update' ? busy.updating : id === 'merge' ? busy.enablingAutoMerge : false
  return { id, label: flow.label, disabled }
}

export function alternatePullRequestAction(recommendation: PullRequestActionRecommendation) {
  return recommendation.id === 'work' ? { id: 'review' as const, label: 'Review' } : { id: 'work' as const, label: 'Work' }
}

export function pullRequestQueueGroup(pullRequest: PullRequest, context: PullRequestActionContext = {}): PullRequestQueueGroupId {
  const group = pullRequestSummaryFlow(pullRequest, context.identity || { status: 'unavailable' }, context.threads).group
  if (group === 'fix') return 'action'
  if (group === 'review') return 'review'
  if (group === 'ready') return 'ship'
  return 'waiting'
}

export function groupPullRequestsForQueue(pullRequests: PullRequest[], context: PullRequestActionContext = {}) {
  const order: PullRequestQueueGroupId[] = ['action', 'review', 'ship', 'waiting']
  return order
    .map((id) => ({ id, pullRequests: pullRequests.filter((pullRequest) => pullRequestQueueGroup(pullRequest, context) === id) }))
    .filter((group) => group.pullRequests.length)
}

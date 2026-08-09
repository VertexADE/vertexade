import type { ReactNode } from 'react'
import type { DiffFile } from '@vertexade/ui/lib/dashboard-types'
import type { PullRequestReviewComment, PullRequestReviewThread } from '@vertexade/ui/lib/pr-review-thread'
import type { ScmReferencePresentation } from '@vertexade/platform-contracts'
import { pullRequestFlow } from '@vertexade/ui/lib/pull-request-flow'

export type Person = { login: string; name?: string }
export type Comment = PullRequestReviewComment
export type Commit = {
  oid: string
  messageHeadline: string
  messageBody?: string
  authoredDate: string
  committedDate: string
  authors: Person[]
}
export type CheckResult = {
  __typename?: string
  name?: string
  context?: string
  workflowName?: string
  status?: string
  conclusion?: string
  state?: string
  detailsUrl?: string
  targetUrl?: string
  startedAt?: string
  completedAt?: string
}
export type ReviewThread = PullRequestReviewThread

export type PullRequestDetails = {
  full_name: string
  number: number
  title: string
  body: string
  url: string
  author: Person
  createdAt: string
  updatedAt: string
  additions: number
  deletions: number
  changedFiles: number
  commits: Commit[]
  comments: Comment[]
  reviews: Comment[]
  statusCheckRollup: CheckResult[]
  assignees: Person[]
  milestone: { title: string } | null
  mergeable: string
  mergeStateStatus: string
  reviewDecision: string
  headRefName: string
  headRefOid: string
  baseRefName: string
  isDraft: boolean
  labels: Array<{ name: string; color: string }>
  reviewThreads: ReviewThread[]
  diff: string
  diff_summary: { files: DiffFile[]; additions: number; deletions: number }
  reference_presentation?: ScmReferencePresentation | null
  scm_provider_name?: string
  shadow_review?: { id: number; author: string; body: string; created_at: string | null } | null
}

type PullRequestDecisionDetails = Pick<PullRequestDetails, 'statusCheckRollup' | 'reviewDecision' | 'mergeable' | 'mergeStateStatus'>

function statusValue(check: CheckResult) {
  return String(check.conclusion || check.state || check.status || 'UNKNOWN').toUpperCase()
}

export function pullRequestNextDecision(details: PullRequestDecisionDetails) {
  const statuses = details.statusCheckRollup.map(statusValue)
  const failed = statuses.filter((status) => ['FAILURE', 'FAILED', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(status)).length
  const pending = statuses.filter((status) => ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED'].includes(status)).length
  const result = pullRequestFlow({
    draft: false,
    checksFailed: failed,
    checksPending: pending,
    reviewDecision: details.reviewDecision,
    mergeState: details.mergeStateStatus,
    mergeable: details.mergeable,
    autoMergeEnabled: false,
    manualNotReady: false,
    updatedAfterNotReady: false,
    authoredByMe: false,
    assignedToMe: false,
    identity: 'unavailable',
    agentReview: 'none',
  })
  return { title: result.title, detail: result.detail }
}

export type PrDetailsActions = {
  onStartWork?: () => void
  onStartReview?: () => void
  contextualReviewActions?: ReactNode
  contextualMenuActions?: ReactNode
}

export type PrDetailsTab = 'conversation' | 'changes' | 'checks' | 'commits'

export function pullRequestInitialTab(details: PullRequestDecisionDetails & Pick<PullRequestDetails, 'reviewThreads'>): PrDetailsTab {
  const statuses = details.statusCheckRollup.map(statusValue)
  if (statuses.some((status) => ['FAILURE', 'FAILED', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(status))) return 'checks'
  if (details.reviewDecision === 'CHANGES_REQUESTED' || details.reviewThreads.some((thread) => !thread.isResolved)) return 'conversation'
  if (details.reviewDecision !== 'APPROVED') return 'changes'
  return 'conversation'
}

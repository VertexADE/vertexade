import { agentThreadState, compareAgentThreadActivity } from './agent-thread-state'
import { isReviewJob } from './activity-status'
import { parseJson } from './dashboard-api'
import type { GithubReviewer, Job, PullRequest } from './dashboard-types'

export type PullRequestIdentity = { status: 'loading' | 'unavailable'; login?: undefined } | { status: 'ready'; login: string }

export type PullRequestAgentReviewState = 'none' | 'running' | 'waiting' | 'ready' | 'outdated' | 'failed'

export type PullRequestFlowGroup = 'fix' | 'review' | 'ready' | 'waiting'

export type PullRequestFlowIntent =
  | 'mark-ready'
  | 'fix-with-agent'
  | 'inspect-checks'
  | 'review-changes'
  | 'update-branch'
  | 'open-agent-review'
  | 'review-with-agent'
  | 'enable-auto-merge'
  | 'monitor-auto-merge'
  | 'open-details'

export type PullRequestFlowInput = {
  draft: boolean
  checksFailed: number
  checksPending: number
  reviewDecision: string | null
  mergeState: string | null
  mergeable?: string | null
  autoMergeEnabled: boolean
  manualNotReady: boolean
  updatedAfterNotReady: boolean
  authoredByMe: boolean
  assignedToMe: boolean
  identity: PullRequestIdentity['status']
  agentReview: PullRequestAgentReviewState
}

export type PullRequestFlowDecision = {
  group: PullRequestFlowGroup
  intent: PullRequestFlowIntent
  label: string
  title: string
  detail: string
  sortRank: number
}

export type PullRequestApprovalEligibility = { enabled: true; reason: null } | { enabled: false; reason: string }

const decision = (
  group: PullRequestFlowGroup,
  intent: PullRequestFlowIntent,
  label: string,
  title: string,
  detail: string,
  sortRank: number,
): PullRequestFlowDecision => ({ group, intent, label, title, detail, sortRank })

function branchBlocker(input: PullRequestFlowInput) {
  if (['CONFLICTING', 'DIRTY'].includes(String(input.mergeable || '').toUpperCase())) {
    return input.authoredByMe
      ? decision('fix', 'fix-with-agent', 'Resolve conflicts', 'Resolve merge conflicts', 'The branch cannot merge cleanly.', 20)
      : decision('fix', 'open-details', 'Inspect conflicts', 'Resolve merge conflicts', 'The branch cannot merge cleanly.', 20)
  }
  if (String(input.mergeState || '').toUpperCase() === 'BEHIND')
    return decision('fix', 'update-branch', 'Update branch', 'Update the branch', 'Bring the branch up to date before continuing.', 30)
  return null
}

function agentDecision(input: PullRequestFlowInput) {
  if (input.agentReview === 'waiting')
    return decision(
      'review',
      'open-agent-review',
      'Answer agent',
      'Agent needs your input',
      'Open the review and answer the pending question.',
      40,
    )
  if (input.agentReview === 'running')
    return decision(
      'waiting',
      'open-agent-review',
      'View agent review',
      'Agent review is running',
      'Review evidence will appear when the run completes.',
      80,
    )
  if (input.agentReview === 'ready')
    return decision(
      'review',
      'open-agent-review',
      'Open agent review',
      'Agent review is ready',
      'Read the current review before deciding.',
      45,
    )
  if (input.agentReview === 'failed')
    return decision(
      'fix',
      'open-agent-review',
      'Inspect failed review',
      'Agent review failed',
      'Inspect the failure and retry or choose another path.',
      15,
    )
  return null
}

function humanReviewDecision(input: PullRequestFlowInput) {
  if (String(input.reviewDecision || '').toUpperCase() === 'APPROVED') return null
  if (input.authoredByMe)
    return decision(
      'review',
      'review-with-agent',
      'Review with agent',
      'Waiting for review',
      'Ask an agent for private evidence or assign a reviewer.',
      55,
    )
  return decision(
    'review',
    'review-changes',
    'Review changes',
    'Review the change',
    'Read the evidence and submit a human review decision.',
    50,
  )
}

export function pullRequestFlow(input: PullRequestFlowInput): PullRequestFlowDecision {
  const steps = [
    failedChecksDecision,
    feedbackDecision,
    branchBlocker,
    readinessDecision,
    agentDecision,
    draftDecision,
    humanReviewDecision,
  ]
  for (const step of steps) {
    const result = step(input)
    if (result) return result
  }
  return completionDecision(input)
}

function failedChecksDecision(input: PullRequestFlowInput) {
  if (input.checksFailed <= 0) return null
  return input.authoredByMe
    ? decision('fix', 'fix-with-agent', 'Fix failing checks', 'Checks need attention', 'Resolve failing checks before merge.', 10)
    : decision('fix', 'inspect-checks', 'Inspect failed checks', 'Checks need attention', 'Inspect the failures before deciding.', 10)
}

function feedbackDecision(input: PullRequestFlowInput) {
  if (String(input.reviewDecision || '').toUpperCase() !== 'CHANGES_REQUESTED') return null
  return input.authoredByMe
    ? decision(
        'fix',
        'fix-with-agent',
        'Address feedback',
        'Changes were requested',
        'Resolve the open feedback before another review.',
        12,
      )
    : decision(
        'review',
        'review-changes',
        'Review feedback',
        'Changes were requested',
        'Inspect the open feedback and current revision.',
        12,
      )
}

function readinessDecision(input: PullRequestFlowInput) {
  if (input.updatedAfterNotReady)
    return decision(
      'review',
      'review-changes',
      'Review update',
      'Updated since not ready',
      'Reassess the new revision and its discussion.',
      35,
    )
  if (input.manualNotReady)
    return decision('waiting', 'open-details', 'View status', 'Marked not ready', 'Wait for a new revision or clear the manual hold.', 90)
  return null
}

function draftDecision(input: PullRequestFlowInput) {
  if (!input.draft) return null
  return input.authoredByMe
    ? decision('review', 'mark-ready', 'Mark ready', 'Publish for review', 'Publish the draft when it is ready for reviewers.', 60)
    : decision('waiting', 'open-details', 'View draft', 'Draft is not ready', 'Wait for the author to publish this revision.', 95)
}

function completionDecision(input: PullRequestFlowInput) {
  if (input.checksPending > 0)
    return decision(
      'waiting',
      'inspect-checks',
      'Inspect checks',
      'Checks are still running',
      'Approval is complete; wait for automation.',
      85,
    )
  if (input.autoMergeEnabled)
    return decision(
      'waiting',
      'monitor-auto-merge',
      'Monitor auto-merge',
      'Auto-merge is enabled',
      'GitHub will merge when its remaining requirements pass.',
      88,
    )
  return decision(
    'ready',
    'enable-auto-merge',
    'Enable auto-merge',
    'Ready to merge',
    'Review, checks, and branch state no longer block this pull request.',
    70,
  )
}

function reviewJobsForPullRequest(pr: PullRequest, threads: Job[]) {
  return threads
    .filter((job) => isReviewJob(job) && job.repo_id === pr.repo_id && (job.pr_number === pr.number || job.linked_pr_number === pr.number))
    .sort(compareAgentThreadActivity)
}

export function pullRequestAgentReviewState(pr: PullRequest, threads: Job[]): PullRequestAgentReviewState {
  const jobs = reviewJobsForPullRequest(pr, threads)
  const active = jobs.find((job) => ['waiting', 'starting', 'running'].includes(agentThreadState(job)))
  if (active) return agentThreadState(active) === 'waiting' ? 'waiting' : 'running'
  const current = jobs.find((job) => job.status === 'completed' && (!job.head_sha || job.head_sha === pr.head_sha))
  if (current || (pr.latest_agent_review_id && pr.latest_agent_review_head_sha === pr.head_sha)) return 'ready'
  if (jobs[0]?.status === 'failed') return 'failed'
  if (jobs.length || (pr.latest_agent_review_id && pr.latest_agent_review_head_sha !== pr.head_sha)) return 'outdated'
  return 'none'
}

export function pullRequestSummaryFlow(pr: PullRequest, identity: PullRequestIdentity, threads: Job[] = []) {
  const reviewers = parseJson<GithubReviewer[]>(pr.reviewers, [])
  const login = identity.status === 'ready' ? identity.login.toLowerCase() : ''
  return pullRequestFlow({
    draft: Boolean(pr.draft),
    checksFailed: pr.checks_failed,
    checksPending: pr.checks_pending,
    reviewDecision: pr.review_decision,
    mergeState: pr.merge_state_status,
    autoMergeEnabled: Boolean(pr.auto_merge_enabled),
    manualNotReady: Boolean(pr.manual_not_ready_at),
    updatedAfterNotReady: Boolean(pr.updated_after_not_ready_at),
    authoredByMe: Boolean(login && String(pr.author || '').toLowerCase() === login),
    assignedToMe: Boolean(login && reviewers.some((reviewer) => reviewer.login.toLowerCase() === login)),
    identity: identity.status,
    agentReview: pullRequestAgentReviewState(pr, threads),
  })
}

export function pullRequestApprovalEligibility(pr: PullRequest, identity: PullRequestIdentity): PullRequestApprovalEligibility {
  if (identity.status !== 'ready') return { enabled: false, reason: 'Current source-control identity is unavailable' }
  if (String(pr.author || '').toLowerCase() === identity.login.toLowerCase())
    return { enabled: false, reason: 'You cannot approve your own pull request' }
  if (pr.draft) return { enabled: false, reason: 'Draft pull requests cannot be approved' }
  if (pr.checks_failed > 0) return { enabled: false, reason: 'Resolve failing checks before approval' }
  return { enabled: true, reason: null }
}

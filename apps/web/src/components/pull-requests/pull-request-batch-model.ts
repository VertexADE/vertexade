import { parseJson } from '@vertexade/ui/lib/dashboard-api'
import type { GithubReviewer, PullRequest } from '@vertexade/ui/lib/dashboard-types'

export type PullRequestBatchAction = 'review' | 'watch' | 'assign' | 'update'

export const pullRequestBatchActions: { id: PullRequestBatchAction; label: string; description: string }[] = [
  { id: 'review', label: 'Review with agent', description: 'Start a private review with the configured default agent.' },
  { id: 'watch', label: 'Watch new commits', description: 'Automatically review a new head when it arrives.' },
  { id: 'assign', label: 'Assign me as reviewer', description: 'Request your review on each eligible pull request.' },
  { id: 'update', label: 'Update branches', description: 'Bring branches reported as behind up to date.' },
]

export type PullRequestBatchCandidate = {
  pr: PullRequest
  eligible: boolean
  reason: string | null
}

export function pullRequestBatchKey(pr: PullRequest) {
  return `${pr.repo_id}:${pr.number}`
}

export function pullRequestBatchCandidates(
  pullRequests: PullRequest[],
  action: PullRequestBatchAction,
  currentUser: GithubReviewer | null,
): PullRequestBatchCandidate[] {
  return pullRequests.map((pr) => {
    const reason = pullRequestBatchExclusion(pr, action, currentUser)
    return { pr, eligible: reason === null, reason }
  })
}

function pullRequestBatchExclusion(pr: PullRequest, action: PullRequestBatchAction, currentUser: GithubReviewer | null) {
  return batchExclusion[action](pr, currentUser)
}

const draftBatchExclusion = (pr: PullRequest) => (pr.draft ? 'Drafts stay out of batch review workflows' : null)

const batchExclusion: Record<PullRequestBatchAction, (pr: PullRequest, currentUser: GithubReviewer | null) => string | null> = {
  review: (pr) => draftBatchExclusion(pr),
  watch: (pr) => draftBatchExclusion(pr) || (pr.auto_review_watch ? 'Already watching new commits' : null),
  update: (pr) => (pr.merge_state_status === 'BEHIND' ? null : 'Branch is not behind'),
  assign: assignBatchExclusion,
}

function assignBatchExclusion(pr: PullRequest, currentUser: GithubReviewer | null) {
  const draft = draftBatchExclusion(pr)
  if (draft) return draft
  if (!currentUser) return 'Source-control identity is unavailable'
  if (String(pr.author || '').toLowerCase() === currentUser.login.toLowerCase()) return 'You authored this pull request'
  const reviewers = parseJson<GithubReviewer[]>(pr.reviewers, [])
  if (reviewers.some((reviewer) => reviewer.login.toLowerCase() === currentUser.login.toLowerCase())) return 'Already assigned to you'
  return null
}

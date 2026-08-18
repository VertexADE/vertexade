import type { PullRequest } from '@vertexade/ui/lib/dashboard-types'

function identity(pullRequest: PullRequest) {
  return `${pullRequest.full_name.trim().toLowerCase()}#${pullRequest.number}`
}

function newer(left: string | null | undefined, right: string | null | undefined) {
  return String(left || '').localeCompare(String(right || '')) > 0
}

function preferredPullRequest(current: PullRequest, candidate: PullRequest, defaultBackendId?: string) {
  if (candidate.backend_id === defaultBackendId && current.backend_id !== defaultBackendId) return candidate
  if (current.backend_id === defaultBackendId && candidate.backend_id !== defaultBackendId) return current
  return newer(candidate.updated_at, current.updated_at) ? candidate : current
}

function reviewSource(left: PullRequest, right: PullRequest, preferred: PullRequest) {
  if (newer(right.latest_agent_review_created_at, left.latest_agent_review_created_at)) return right
  if (newer(left.latest_agent_review_created_at, right.latest_agent_review_created_at)) return left
  return preferred
}

function linkedWorkSource(left: PullRequest, right: PullRequest, preferred: PullRequest) {
  if (preferred.work_item_id || preferred.work_item_key) return preferred
  if (left.work_item_id || left.work_item_key) return left
  return right
}

function mergePullRequests(current: PullRequest, candidate: PullRequest, defaultBackendId?: string): PullRequest {
  const preferred = preferredPullRequest(current, candidate, defaultBackendId)
  const review = reviewSource(current, candidate, preferred)
  const linkedWork = linkedWorkSource(current, candidate, preferred)
  return {
    ...preferred,
    latest_agent_review_id: review.latest_agent_review_id,
    latest_agent_review_head_sha: review.latest_agent_review_head_sha,
    latest_agent_review_created_at: review.latest_agent_review_created_at,
    latest_agent_review_finished_at: review.latest_agent_review_finished_at,
    latest_agent_review_agent_id: review.latest_agent_review_agent_id,
    latest_agent_review_automatic: review.latest_agent_review_automatic,
    work_item_id: linkedWork.work_item_id,
    work_item_key: linkedWork.work_item_key,
  }
}

export function unifiedPullRequests(pullRequests: PullRequest[], defaultBackendId?: string) {
  const unified = new Map<string, PullRequest>()
  for (const pullRequest of pullRequests) {
    const key = identity(pullRequest)
    const current = unified.get(key)
    unified.set(key, current ? mergePullRequests(current, pullRequest, defaultBackendId) : pullRequest)
  }
  return [...unified.values()]
}

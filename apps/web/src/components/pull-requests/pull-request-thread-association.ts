import type { Job, PullRequest } from '@vertexade/ui/lib/dashboard-types'

export function threadBelongsToPullRequest(thread: Job, pr: PullRequest) {
  const numberMatches = thread.pr_number === pr.number || thread.linked_pr_number === pr.number
  if (!numberMatches) return false
  if (thread.full_name && pr.full_name) return thread.full_name.toLowerCase() === pr.full_name.toLowerCase()
  return thread.repo_id === pr.repo_id
}

export function pullRequestThreads(pr: PullRequest, threads: Job[]) {
  return threads.filter((thread) => threadBelongsToPullRequest(thread, pr))
}

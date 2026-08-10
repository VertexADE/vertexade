import type { Job, PullRequestDialogItem, WorkResource } from './dashboard-types'

export type WorkDetailSection = 'overview' | 'threads' | 'memory' | 'links' | 'activity' | 'impact'
export type WorkDetailSearch = {
  section?: WorkDetailSection
  thread?: number
  repo?: number
  pr?: number
}

export const dialogNavigationOptions = { resetScroll: false } as const

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

export function workDetailSearch(search: Record<string, unknown>): WorkDetailSearch {
  const section = ['overview', 'threads', 'memory', 'links', 'activity', 'impact'].includes(String(search.section))
    ? (String(search.section) as WorkDetailSection)
    : undefined
  return {
    section,
    thread: positiveInteger(search.thread),
    repo: positiveInteger(search.repo),
    pr: positiveInteger(search.pr),
  }
}

function repositoryName(resource: WorkResource) {
  const suffix = `#${resource.metadata.number}`
  return resource.external_id.endsWith(suffix) ? resource.external_id.slice(0, -suffix.length) : ''
}

type WorkDialogJob = Pick<Job, 'id' | 'status' | 'kind' | 'pr_number' | 'linked_pr_number' | 'full_name' | 'head_sha'>

function latestReview(resource: WorkResource, threads: WorkDialogJob[]) {
  const number = Number(resource.metadata.number)
  const fullName = repositoryName(resource).toLowerCase()
  return threads
    .filter(
      (job) =>
        job.kind === 'review' &&
        job.status === 'completed' &&
        job.full_name.toLowerCase() === fullName &&
        (job.pr_number === number || job.linked_pr_number === number),
    )
    .sort((left, right) => right.id - left.id)[0]
}

export function pullRequestDialogItem(resource: WorkResource, threads: WorkDialogJob[] = []): PullRequestDialogItem | null {
  if (resource.kind !== 'pull_request') return null
  const repoId = positiveInteger(resource.repository_id)
  const number = positiveInteger(resource.metadata.number)
  const fullName = repositoryName(resource)
  if (!repoId || !number || !fullName) return null
  const review = latestReview(resource, threads)
  return {
    repo_id: repoId,
    full_name: fullName,
    number,
    title: resource.label.replace(/^PR #\d+\s*·\s*/, ''),
    url: resource.url || '',
    head_sha: String(resource.metadata.headSha || ''),
    latest_agent_review_id: review?.id,
    latest_agent_review_head_sha: review?.head_sha || undefined,
  }
}

export function selectedPullRequest(resources: WorkResource[], threads: WorkDialogJob[], search: WorkDetailSearch) {
  if (!search.repo || !search.pr) return null
  return (
    resources
      .map((resource) => pullRequestDialogItem(resource, threads))
      .find((item) => item?.repo_id === search.repo && item?.number === search.pr) || null
  )
}

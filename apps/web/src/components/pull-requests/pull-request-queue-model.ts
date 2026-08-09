import type { GithubLabel, GithubReviewer, Job, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import { dateValue, parseJson } from '@vertexade/ui/lib/dashboard-api'
import { parseConventionalTitle } from '@vertexade/ui/lib/conventional-title'
import { pullRequestAgentReviewState, pullRequestSummaryFlow, type PullRequestIdentity } from '@vertexade/ui/lib/pull-request-flow'
import type { PullRequestFiltersValue as Filters } from './pull-request-filters'
import { defaultValue, mergeDefined } from '../../lib/route-search'

export const pullRequestFilterStorageKey = 'vertexade.filters.v2'

export type PullRequestView = 'for-you' | 'action' | 'ready' | 'all' | 'stacks'
export type PullRequestViewSearch = PullRequestView | 'attention' | 'mine'

export type PullRequestDashboardSearch = {
  repo?: string
  backend?: string
  pr?: number
  thread?: number
  tab?: 'conversation' | 'changes' | 'checks' | 'commits'
  view?: PullRequestViewSearch
  q?: string
  repos?: string
  status?: Filters['status']
  author?: string
  reviewer?: string
  checks?: Filters['checks']
  age?: Filters['age']
  label?: string
  branch?: Filters['branch']
  type?: string
  service?: string
}

export function defaultPullRequestFilters(): Filters {
  return {
    query: '',
    repositories: [],
    status: 'all',
    author: 'all',
    reviewer: 'all',
    checks: 'all',
    age: 'all',
    label: 'all',
    branch: 'all',
    conventionalType: 'all',
    service: 'all',
  }
}

export function parseStoredPullRequestFilters(raw: string | null): Filters {
  const defaults = defaultPullRequestFilters()
  try {
    const value = JSON.parse(raw || '{}')
    return {
      query: typeof value.query === 'string' ? value.query : defaults.query,
      repositories: Array.isArray(value.repositories)
        ? value.repositories.filter((item: unknown): item is string => typeof item === 'string')
        : defaults.repositories,
      status: ['all', 'ready', 'draft'].includes(value.status) ? value.status : defaults.status,
      author: typeof value.author === 'string' ? value.author : defaults.author,
      reviewer: typeof value.reviewer === 'string' ? value.reviewer : defaults.reviewer,
      checks: ['all', 'clear', 'pending', 'failed'].includes(value.checks) ? value.checks : defaults.checks,
      age: ['all', 'day', 'week', 'month'].includes(value.age) ? value.age : defaults.age,
      label: typeof value.label === 'string' ? value.label : defaults.label,
      branch: ['all', 'current', 'behind'].includes(value.branch) ? value.branch : defaults.branch,
      conventionalType: typeof value.conventionalType === 'string' ? value.conventionalType : defaults.conventionalType,
      service: typeof value.service === 'string' ? value.service : defaults.service,
    }
  } catch {
    return defaults
  }
}

export function pullRequestFiltersFromSearch(search: PullRequestDashboardSearch, fallback: Filters): Filters {
  return mergeDefined(fallback, {
    query: search.q,
    repositories: search.repos?.split(',').map(decodeURIComponent).filter(Boolean),
    status: search.status,
    author: search.author,
    reviewer: search.reviewer,
    checks: search.checks,
    age: search.age,
    label: search.label,
    branch: search.branch,
    conventionalType: search.type,
    service: search.service,
  })
}

export function pullRequestFilterSearch(
  filters: Filters,
): Pick<
  PullRequestDashboardSearch,
  'q' | 'repos' | 'status' | 'author' | 'reviewer' | 'checks' | 'age' | 'label' | 'branch' | 'type' | 'service'
> {
  return {
    q: filters.query || undefined,
    repos: filters.repositories.length ? filters.repositories.map(encodeURIComponent).join(',') : undefined,
    status: defaultValue(filters.status, 'all'),
    author: defaultValue(filters.author, 'all'),
    reviewer: defaultValue(filters.reviewer, 'all'),
    checks: defaultValue(filters.checks, 'all'),
    age: defaultValue(filters.age, 'all'),
    label: defaultValue(filters.label, 'all'),
    branch: defaultValue(filters.branch, 'all'),
    type: defaultValue(filters.conventionalType, 'all'),
    service: defaultValue(filters.service, 'all'),
  }
}

export function filterPullRequests(pullRequests: PullRequest[], filters: Filters, currentUser: GithubReviewer | null, renderedAt: number) {
  return pullRequests.filter((pullRequest) => pullRequestMatches(pullRequest, filters, currentUser, renderedAt))
}

function pullRequestMatches(pr: PullRequest, filters: Filters, currentUser: GithubReviewer | null, renderedAt: number) {
  const reviewers = parseJson<GithubReviewer[]>(pr.reviewers, [])
  const labels = parseJson<GithubLabel[]>(pr.labels, [])
  const conventional = parseConventionalTitle(pr.title)
  return [
    repositoryMatches(pr, filters),
    statusMatches(pr, filters),
    filters.author === 'all' || pr.author === filters.author,
    reviewerMatches(reviewers, filters.reviewer, currentUser),
    checksMatch(pr, filters.checks),
    ageMatches(pr, filters.age, renderedAt),
    filters.label === 'all' || labels.some((label) => label.name === filters.label),
    branchMatches(pr, filters.branch),
    filters.conventionalType === 'all' || conventional?.type === filters.conventionalType,
    filters.service === 'all' || conventional?.scope === filters.service,
    queryMatches(pr, labels, reviewers, filters.query),
  ].every(Boolean)
}

function repositoryMatches(pr: PullRequest, filters: Filters) {
  return filters.repositories.length === 0 || filters.repositories.includes(pr.full_name)
}

function statusMatches(pr: PullRequest, filters: Filters) {
  if (filters.status === 'all') return true
  return filters.status === 'draft' ? Boolean(pr.draft) : !pr.draft
}

function reviewerMatches(reviewers: GithubReviewer[], selected: string, currentUser: GithubReviewer | null) {
  if (selected === 'all') return true
  if (selected === 'mine') return Boolean(currentUser && reviewers.some((reviewer) => reviewer.login === currentUser.login))
  if (selected === 'unassigned') return reviewers.length === 0
  return reviewers.some((reviewer) => reviewer.login === selected)
}

function checksMatch(pr: PullRequest, selected: Filters['checks']) {
  if (selected === 'all') return true
  if (selected === 'failed') return pr.checks_failed > 0
  if (selected === 'pending') return pr.checks_failed === 0 && pr.checks_pending > 0
  return pr.checks_failed === 0 && pr.checks_pending === 0
}

function ageMatches(pr: PullRequest, selected: Filters['age'], renderedAt: number) {
  const minimumAge = { all: 0, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }[selected]
  const createdAt = dateValue(pr.created_at)?.getTime() || renderedAt
  return minimumAge === 0 || renderedAt - createdAt >= minimumAge
}

function branchMatches(pr: PullRequest, selected: Filters['branch']) {
  if (selected === 'all') return true
  return selected === 'behind' ? pr.merge_state_status === 'BEHIND' : pr.merge_state_status !== 'BEHIND'
}

function queryMatches(pr: PullRequest, labels: GithubLabel[], reviewers: GithubReviewer[], query: string) {
  if (!query) return true
  const haystack =
    `${pr.title} ${pr.author} ${pr.full_name} #${pr.number} ${pr.head_ref} ${pr.base_ref} ${labels.map((label) => label.name).join(' ')} ${reviewers.map((reviewer) => reviewer.login).join(' ')}`.toLowerCase()
  return haystack.includes(query.toLowerCase())
}

export function pullRequestFilterOptions(pullRequests: PullRequest[]) {
  const authors = new Set<string>()
  const reviewers = new Set<string>()
  const labels = new Set<string>()
  const types = new Set<string>()
  const services = new Set<string>()
  for (const pr of pullRequests) {
    if (pr.author) authors.add(pr.author)
    for (const reviewer of parseJson<GithubReviewer[]>(pr.reviewers, [])) reviewers.add(reviewer.login)
    for (const label of parseJson<GithubLabel[]>(pr.labels, [])) labels.add(label.name)
    const conventional = parseConventionalTitle(pr.title)
    if (conventional?.type) types.add(conventional.type)
    if (conventional?.scope) services.add(conventional.scope)
  }
  return {
    authors: [...authors].sort(),
    reviewers: [...reviewers].sort(),
    labels: [...labels].sort(),
    types: [...types].sort(),
    services: [...services].sort(),
  }
}

export function canonicalPullRequestView(
  view: PullRequestViewSearch | undefined,
  identity: PullRequestIdentity['status'],
): PullRequestView {
  if (view === 'mine') return 'for-you'
  if (view === 'attention') return 'action'
  if (view) return view
  return identity === 'ready' ? 'for-you' : 'action'
}

function pullRequestOwnership(pr: PullRequest, identity: PullRequestIdentity) {
  const login = identity.status === 'ready' ? identity.login.toLowerCase() : ''
  const reviewers = parseJson<GithubReviewer[]>(pr.reviewers, [])
  return {
    authored: Boolean(login && String(pr.author || '').toLowerCase() === login),
    assigned: Boolean(login && reviewers.some((reviewer) => reviewer.login.toLowerCase() === login)),
  }
}

function pullRequestBelongsInView(view: PullRequestView, pr: PullRequest, identity: PullRequestIdentity, threads: Job[]) {
  if (view === 'all' || view === 'stacks') return true
  const ownership = pullRequestOwnership(pr, identity)
  const flow = pullRequestSummaryFlow(pr, identity, threads)
  const agentReview = pullRequestAgentReviewState(pr, threads)
  if (view === 'ready') return flow.group === 'ready' || flow.intent === 'monitor-auto-merge'
  if (view === 'for-you') return pullRequestIsForYou(pr, identity, ownership, flow, agentReview)
  return pullRequestNeedsAction(pr, ownership, flow, agentReview)
}

type PullRequestOwnership = ReturnType<typeof pullRequestOwnership>
type PullRequestSummary = ReturnType<typeof pullRequestSummaryFlow>
type AgentReviewState = ReturnType<typeof pullRequestAgentReviewState>

function agentReviewNeedsDecision(agentReview: AgentReviewState) {
  return agentReview === 'ready' || agentReview === 'waiting' || agentReview === 'failed'
}

function pullRequestIsForYou(
  pr: PullRequest,
  identity: PullRequestIdentity,
  ownership: PullRequestOwnership,
  flow: PullRequestSummary,
  agentReview: AgentReviewState,
) {
  if (identity.status !== 'ready') return false
  const authoredAction = ownership.authored && (flow.group === 'fix' || flow.intent === 'mark-ready')
  const assignedReview = ownership.assigned && !pr.draft && flow.group !== 'ready'
  return authoredAction || assignedReview || agentReviewNeedsDecision(agentReview)
}

function pullRequestNeedsAction(pr: PullRequest, ownership: PullRequestOwnership, flow: PullRequestSummary, agentReview: AgentReviewState) {
  if (pr.draft && !ownership.authored && !ownership.assigned) return false
  if (flow.group === 'fix') return true
  if (agentReviewNeedsDecision(agentReview)) return true
  if (flow.intent === 'mark-ready') return ownership.authored
  return flow.group === 'review' && (ownership.assigned || pr.review_decision === 'REVIEW_REQUIRED')
}

function pullRequestSort(pr: PullRequest, identity: PullRequestIdentity, threads: Job[]) {
  const ownership = pullRequestOwnership(pr, identity)
  const agentReview = pullRequestAgentReviewState(pr, threads)
  const flow = pullRequestSummaryFlow(pr, identity, threads)
  return {
    ownership: ownership.assigned ? 0 : ownership.authored ? 1 : agentReviewNeedsDecision(agentReview) ? 2 : 3,
    flow: flow.sortRank,
    agent: { waiting: 0, ready: 1, failed: 2, running: 3, outdated: 4, none: 5 }[agentReview],
    updated: Date.parse(pr.updated_at) || 0,
  }
}

function comparePullRequests(left: PullRequest, right: PullRequest, identity: PullRequestIdentity, allThreads: Job[]) {
  const leftThreads = allThreads.filter(
    (job) => job.repo_id === left.repo_id && (job.pr_number === left.number || job.linked_pr_number === left.number),
  )
  const rightThreads = allThreads.filter(
    (job) => job.repo_id === right.repo_id && (job.pr_number === right.number || job.linked_pr_number === right.number),
  )
  const a = pullRequestSort(left, identity, leftThreads)
  const b = pullRequestSort(right, identity, rightThreads)
  return (
    a.ownership - b.ownership ||
    a.flow - b.flow ||
    a.agent - b.agent ||
    b.updated - a.updated ||
    left.full_name.localeCompare(right.full_name) ||
    left.number - right.number
  )
}

export function pullRequestsForView(
  view: PullRequestView,
  pullRequests: PullRequest[],
  identity: PullRequestIdentity,
  threads: Job[] = [],
) {
  return pullRequests
    .filter((pr) => {
      const related = threads.filter(
        (job) => job.repo_id === pr.repo_id && (job.pr_number === pr.number || job.linked_pr_number === pr.number),
      )
      return pullRequestBelongsInView(view, pr, identity, related)
    })
    .sort((left, right) => comparePullRequests(left, right, identity, threads))
}

export function pullRequestFilterCounts(filters: Filters) {
  const entries = Object.entries(filters)
  return {
    active: entries.filter(([key, value]) =>
      key === 'repositories' ? (value as string[]).length > 0 : key === 'query' ? Boolean(value) : value !== 'all',
    ).length,
    advanced: entries.filter(([key, value]) => !['query', 'repositories', 'status'].includes(key) && value !== 'all').length,
  }
}

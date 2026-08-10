import { describe, expect, it } from 'vite-plus/test'
import type { PullRequest } from '@vertexade/ui/lib/dashboard-types'
import {
  defaultPullRequestFilters,
  filterPullRequests,
  canonicalPullRequestView,
  parseStoredPullRequestFilters,
  pullRequestFilterCounts,
  pullRequestFilterSearch,
  pullRequestFiltersFromSearch,
  pullRequestsForView,
} from './pull-request-queue-model'

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    repo_id: 1,
    full_name: 'acme/widget',
    number: 42,
    title: 'feat(api): ship filters',
    author: 'alice',
    head_ref: 'feature/filters',
    base_ref: 'main',
    head_sha: 'abcdef1',
    draft: 0,
    checks_failed: 0,
    checks_pending: 0,
    merge_state_status: 'CLEAN',
    review_decision: 'APPROVED',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    labels: JSON.stringify([{ name: 'backend', color: '000000' }]),
    reviewers: JSON.stringify([{ login: 'reviewer' }]),
    assignees: '[]',
    ...overrides,
  } as PullRequest
}

describe('pull request queue model', () => {
  it('falls back safely for malformed or invalid stored filters', () => {
    expect(parseStoredPullRequestFilters('{')).toEqual(defaultPullRequestFilters())
    expect(
      parseStoredPullRequestFilters(JSON.stringify({ repositories: [1, 'acme/widget'], status: 'invalid', query: 'api' })),
    ).toMatchObject({
      repositories: ['acme/widget'],
      status: 'all',
      query: 'api',
    })
  })

  it('round-trips non-default filters through search parameters', () => {
    const filters = {
      ...defaultPullRequestFilters(),
      query: 'fix me',
      repositories: ['acme/widget', 'space/name'],
      reviewer: 'mine',
      checks: 'failed' as const,
    }
    const search = pullRequestFilterSearch(filters)

    expect(search).toEqual({ q: 'fix me', repos: 'acme%2Fwidget,space%2Fname', reviewer: 'mine', checks: 'failed' })
    expect(pullRequestFiltersFromSearch(search, defaultPullRequestFilters())).toEqual(filters)
  })

  it('combines repository, reviewer, check, age, label, branch, conventional, and text filters', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z')
    const candidate = pullRequest({ checks_failed: 1, merge_state_status: 'BEHIND', review_decision: 'CHANGES_REQUESTED' })
    const filters = {
      ...defaultPullRequestFilters(),
      query: 'reviewer',
      repositories: ['acme/widget'],
      reviewer: 'mine',
      checks: 'failed' as const,
      age: 'day' as const,
      label: 'backend',
      branch: 'behind' as const,
      conventionalType: 'feat',
      service: 'api',
    }

    expect(filterPullRequests([candidate], filters, { login: 'reviewer' } as never, now)).toEqual([candidate])
    expect(filterPullRequests([candidate], { ...filters, reviewer: 'someone-else' }, { login: 'reviewer' } as never, now)).toEqual([])
  })

  it('keeps old view links meaningful and defaults to ownership after identity resolves', () => {
    expect(canonicalPullRequestView('mine', 'ready')).toBe('for-you')
    expect(canonicalPullRequestView('attention', 'ready')).toBe('action')
    expect(canonicalPullRequestView(undefined, 'loading')).toBe('action')
    expect(canonicalPullRequestView(undefined, 'ready')).toBe('for-you')
  })

  it('limits For you to assigned decisions, authored blockers, and completed agent reviews', () => {
    const identity = { status: 'ready' as const, login: 'reviewer' }
    const authoredPassive = pullRequest({ author: 'reviewer', reviewers: '[]', review_decision: null })
    const authoredBlocked = pullRequest({ number: 43, author: 'reviewer', reviewers: '[]', checks_failed: 1, review_decision: null })
    const assigned = pullRequest({ number: 44, reviewers: JSON.stringify([{ login: 'reviewer' }]), review_decision: 'REVIEW_REQUIRED' })
    const unrelated = pullRequest({ number: 45, reviewers: '[]', review_decision: null })
    const agentReviewed = pullRequest({
      number: 46,
      reviewers: '[]',
      latest_agent_review_id: 9,
      latest_agent_review_head_sha: 'abcdef1',
    })

    expect(pullRequestsForView('for-you', [authoredPassive, authoredBlocked, assigned, unrelated, agentReviewed], identity)).toEqual([
      assigned,
      authoredBlocked,
      agentReviewed,
    ])
  })

  it('keeps passive inventory out of Needs action and approved clear work in Ready', () => {
    const identity = { status: 'ready' as const, login: 'reviewer' }
    const passive = pullRequest({ review_decision: null, reviewers: '[]' })
    const failed = pullRequest({ number: 43, checks_failed: 1, review_decision: null })
    const requested = pullRequest({ number: 44, review_decision: 'REVIEW_REQUIRED', reviewers: '[]' })
    const ready = pullRequest({ number: 45 })

    expect(pullRequestsForView('action', [passive, failed, requested, ready], identity)).toEqual([failed, requested])
    expect(pullRequestsForView('ready', [passive, failed, requested, ready], identity)).toEqual([ready])
  })

  it('uses the source backend identity for authored pull requests', () => {
    const primaryIdentity = { status: 'ready' as const, login: 'DominicVonk' }
    const milencePr = pullRequest({
      backend_id: 'milence-agent',
      author: 'dominicvonk-milence',
      checks_failed: 1,
      review_decision: null,
    })
    const identities = new Map([['milence-agent', { status: 'ready' as const, login: 'dominicvonk-milence' }]])

    expect(pullRequestsForView('for-you', [milencePr], primaryIdentity, [], identities)).toEqual([milencePr])
  })

  it('counts primary and advanced filters independently', () => {
    expect(
      pullRequestFilterCounts({
        ...defaultPullRequestFilters(),
        query: 'api',
        repositories: ['acme/widget'],
        status: 'ready',
        label: 'backend',
      }),
    ).toEqual({ active: 4, advanced: 1 })
  })
})

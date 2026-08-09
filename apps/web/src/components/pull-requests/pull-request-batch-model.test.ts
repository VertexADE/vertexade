import { describe, expect, it } from 'vite-plus/test'
import type { PullRequest } from '@vertexade/ui/lib/dashboard-types'

import { pullRequestBatchActions, pullRequestBatchCandidates } from './pull-request-batch-model'

const base = {
  repo_id: 1,
  number: 12,
  full_name: 'vertexade/example',
  author: 'octocat',
  draft: 0,
  reviewers: '[]',
  merge_state_status: 'CLEAN',
  auto_review_watch: 0,
} as PullRequest

describe('pull request batch eligibility', () => {
  it('exposes only conservative non-verdict operations', () => {
    expect(pullRequestBatchActions.map((action) => action.id)).toEqual(['review', 'watch', 'assign', 'update'])
  })

  it('excludes drafts from review, watch, and assignment without blocking branch updates', () => {
    const draft = { ...base, draft: 1, merge_state_status: 'BEHIND' }
    expect(pullRequestBatchCandidates([draft], 'review', null)[0].reason).toMatch(/Drafts/)
    expect(pullRequestBatchCandidates([draft], 'watch', null)[0].reason).toMatch(/Drafts/)
    expect(pullRequestBatchCandidates([draft], 'assign', { login: 'reviewer', avatar_url: '' })[0].reason).toMatch(/Drafts/)
    expect(pullRequestBatchCandidates([draft], 'update', null)[0].eligible).toBe(true)
  })

  it('explains already-satisfied and identity exclusions', () => {
    expect(pullRequestBatchCandidates([{ ...base, auto_review_watch: 1 }], 'watch', null)[0].reason).toMatch(/Already/)
    expect(pullRequestBatchCandidates([base], 'assign', null)[0].reason).toMatch(/identity/)
    expect(pullRequestBatchCandidates([base], 'assign', { login: 'octocat', avatar_url: '' })[0].reason).toMatch(/authored/)
    expect(
      pullRequestBatchCandidates([{ ...base, reviewers: '[{"login":"reviewer"}]' }], 'assign', {
        login: 'reviewer',
        avatar_url: '',
      })[0].reason,
    ).toMatch(/Already/)
  })
})

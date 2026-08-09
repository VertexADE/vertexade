import { describe, expect, it } from 'vite-plus/test'

import { pullRequestInitialTab, pullRequestNextDecision } from './pr-details-model'

function details(overrides: Partial<Parameters<typeof pullRequestNextDecision>[0]> = {}): Parameters<typeof pullRequestNextDecision>[0] {
  return {
    statusCheckRollup: [{ conclusion: 'SUCCESS' }],
    reviewDecision: '',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    ...overrides,
  }
}

describe('pullRequestNextDecision', () => {
  it('prioritizes failing automation over review state', () => {
    expect(pullRequestNextDecision(details({ statusCheckRollup: [{ conclusion: 'FAILURE' }], reviewDecision: 'APPROVED' })).title).toBe(
      'Checks need attention',
    )
  })

  it('makes the human review decision explicit after checks clear', () => {
    expect(pullRequestNextDecision(details()).title).toBe('Review the change')
  })

  it('does not mistake an explicit required review for merge readiness', () => {
    expect(pullRequestNextDecision(details({ reviewDecision: 'REVIEW_REQUIRED' })).title).toBe('Review the change')
  })

  it('surfaces requested changes before merge readiness', () => {
    expect(pullRequestNextDecision(details({ reviewDecision: 'CHANGES_REQUESTED' })).title).toBe('Changes were requested')
  })

  it('surfaces branch conflicts after approval', () => {
    expect(pullRequestNextDecision(details({ reviewDecision: 'APPROVED', mergeable: 'CONFLICTING' })).title).toBe('Resolve merge conflicts')
  })

  it('prioritizes a branch update before a still-required review', () => {
    expect(pullRequestNextDecision(details({ reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BEHIND' })).title).toBe(
      'Update the branch',
    )
  })

  it('recognizes a fully unblocked pull request', () => {
    expect(pullRequestNextDecision(details({ reviewDecision: 'APPROVED' })).title).toBe('Ready to merge')
  })
})

describe('pullRequestInitialTab', () => {
  it('opens the evidence that matches the next decision', () => {
    expect(pullRequestInitialTab({ ...details({ statusCheckRollup: [{ conclusion: 'FAILURE' }] }), reviewThreads: [] })).toBe('checks')
    expect(pullRequestInitialTab({ ...details({ reviewDecision: 'REVIEW_REQUIRED' }), reviewThreads: [] })).toBe('changes')
    expect(pullRequestInitialTab({ ...details({ reviewDecision: 'APPROVED' }), reviewThreads: [] })).toBe('conversation')
  })

  it('opens discussion when unresolved review feedback exists', () => {
    expect(
      pullRequestInitialTab({
        ...details(),
        reviewThreads: [{ isResolved: false } as never],
      }),
    ).toBe('conversation')
  })
})

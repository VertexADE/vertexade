import { describe, expect, it } from 'vite-plus/test'

import { pullRequestMutationIsBusy, type PullRequestMutationPhase } from './use-pull-request-mutation'

describe('pull request mutation phases', () => {
  it('keeps the explicit lifecycle vocabulary stable', () => {
    const phases: PullRequestMutationPhase[] = ['idle', 'confirming', 'submitting', 'synchronizing', 'succeeded', 'failed', 'retrying']
    expect(phases).toHaveLength(7)
  })

  it('locks the UI only while submission or reconciliation is actually in flight', () => {
    expect(
      ['submitting', 'synchronizing', 'retrying'].filter((phase) => pullRequestMutationIsBusy(phase as PullRequestMutationPhase)),
    ).toEqual(['submitting', 'synchronizing', 'retrying'])
    expect(pullRequestMutationIsBusy('failed')).toBe(false)
    expect(pullRequestMutationIsBusy('succeeded')).toBe(false)
  })
})

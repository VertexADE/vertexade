import { describe, expect, it } from 'vite-plus/test'

import type { PullRequest } from './dashboard-types'
import { pullRequestApprovalEligibility, pullRequestFlow, type PullRequestFlowInput } from './pull-request-flow'

const base: PullRequestFlowInput = {
  draft: false,
  checksFailed: 0,
  checksPending: 0,
  reviewDecision: 'REVIEW_REQUIRED',
  mergeState: 'CLEAN',
  mergeable: 'MERGEABLE',
  autoMergeEnabled: false,
  manualNotReady: false,
  updatedAfterNotReady: false,
  authoredByMe: false,
  assignedToMe: true,
  identity: 'ready',
  agentReview: 'none',
}

const flow = (overrides: Partial<PullRequestFlowInput> = {}) => pullRequestFlow({ ...base, ...overrides })

describe('pull request flow decision', () => {
  it.each([
    ['failed checks owned by me', { checksFailed: 2, authoredByMe: true }, 'fix', 'fix-with-agent', 'Checks need attention'],
    ['failed checks assigned to me', { checksFailed: 2 }, 'fix', 'inspect-checks', 'Checks need attention'],
    [
      'requested feedback owned by me',
      { reviewDecision: 'CHANGES_REQUESTED', authoredByMe: true },
      'fix',
      'fix-with-agent',
      'Changes were requested',
    ],
    [
      'conflicting branch owned by me',
      { mergeable: 'CONFLICTING', authoredByMe: true },
      'fix',
      'fix-with-agent',
      'Resolve merge conflicts',
    ],
    ['behind branch', { mergeState: 'BEHIND' }, 'fix', 'update-branch', 'Update the branch'],
    ['agent waiting', { agentReview: 'waiting' }, 'review', 'open-agent-review', 'Agent needs your input'],
    ['agent running', { agentReview: 'running' }, 'waiting', 'open-agent-review', 'Agent review is running'],
    ['current agent review', { agentReview: 'ready' }, 'review', 'open-agent-review', 'Agent review is ready'],
    ['assigned human review', {}, 'review', 'review-changes', 'Review the change'],
    ['authored review', { authoredByMe: true, assignedToMe: false }, 'review', 'review-with-agent', 'Waiting for review'],
    ['approved pending checks', { reviewDecision: 'APPROVED', checksPending: 2 }, 'waiting', 'inspect-checks', 'Checks are still running'],
    ['approved ready', { reviewDecision: 'APPROVED' }, 'ready', 'enable-auto-merge', 'Ready to merge'],
    [
      'approved auto-merge',
      { reviewDecision: 'APPROVED', autoMergeEnabled: true },
      'waiting',
      'monitor-auto-merge',
      'Auto-merge is enabled',
    ],
  ] as const)('%s', (_name, overrides, group, intent, title) => {
    expect(flow(overrides)).toMatchObject({ group, intent, title })
  })

  it('never lets a required review fall through to merge readiness', () => {
    expect(flow({ reviewDecision: 'REVIEW_REQUIRED' })).toMatchObject({ intent: 'review-changes', title: 'Review the change' })
    expect(flow({ reviewDecision: null })).toMatchObject({ intent: 'review-changes', title: 'Review the change' })
  })

  it('does not recommend publishing a draft to a non-author or unknown identity', () => {
    expect(flow({ draft: true, authoredByMe: false, identity: 'ready' })).toMatchObject({ intent: 'open-details', group: 'waiting' })
    expect(flow({ draft: true, authoredByMe: false, identity: 'loading' })).toMatchObject({ intent: 'open-details', group: 'waiting' })
  })

  it('ranks blockers before review, agent, and merge states', () => {
    expect(
      flow({ checksFailed: 1, reviewDecision: 'APPROVED', mergeState: 'BEHIND', agentReview: 'ready', autoMergeEnabled: true }),
    ).toMatchObject({ intent: 'inspect-checks', sortRank: 10 })
  })

  it('uses one conservative approval policy for identity, author, draft, and checks', () => {
    const pr = { author: 'alice', draft: 0, checks_failed: 0 } as PullRequest
    expect(pullRequestApprovalEligibility(pr, { status: 'loading' })).toMatchObject({ enabled: false })
    expect(pullRequestApprovalEligibility(pr, { status: 'ready', login: 'alice' })).toMatchObject({ enabled: false })
    expect(pullRequestApprovalEligibility({ ...pr, draft: 1 }, { status: 'ready', login: 'bob' })).toMatchObject({ enabled: false })
    expect(pullRequestApprovalEligibility({ ...pr, checks_failed: 1 }, { status: 'ready', login: 'bob' })).toMatchObject({ enabled: false })
    expect(pullRequestApprovalEligibility(pr, { status: 'ready', login: 'bob' })).toEqual({ enabled: true, reason: null })
  })
})

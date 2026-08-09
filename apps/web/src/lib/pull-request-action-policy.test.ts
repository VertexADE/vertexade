import { describe, expect, it } from 'vite-plus/test'
import type { PullRequest } from '@vertexade/ui/lib/dashboard-types'
import {
  alternatePullRequestAction,
  groupPullRequestsForQueue,
  pullRequestQueueGroup,
  recommendedPullRequestAction,
} from './pull-request-action-policy.ts'

const idle = { markingReady: false, updating: false, enablingAutoMerge: false }
const alice = { identity: { status: 'ready' as const, login: 'alice' } }
const reviewer = { identity: { status: 'ready' as const, login: 'reviewer' } }
const pullRequest = {
  author: 'alice',
  reviewers: '[]',
  draft: 0,
  checks_failed: 0,
  checks_pending: 0,
  review_decision: '',
  merge_state_status: '',
  auto_merge_enabled: 0,
} as unknown as PullRequest

describe('pull request action policy', () => {
  it('orders remediation ahead of review and merge actions', () => {
    expect(
      recommendedPullRequestAction(
        {
          ...pullRequest,
          checks_failed: 1,
          review_decision: 'APPROVED',
        },
        idle,
        alice,
      ),
    ).toMatchObject({ id: 'work', label: 'Fix failing checks' })

    expect(
      recommendedPullRequestAction(
        {
          ...pullRequest,
          review_decision: 'CHANGES_REQUESTED',
          merge_state_status: 'BEHIND',
        },
        idle,
        alice,
      ),
    ).toMatchObject({ id: 'work', label: 'Address feedback' })
  })

  it('exposes busy state on the mutation it recommends', () => {
    expect(recommendedPullRequestAction({ ...pullRequest, draft: 1 }, { ...idle, markingReady: true }, alice)).toMatchObject({
      id: 'ready',
      disabled: true,
    })

    expect(
      recommendedPullRequestAction({ ...pullRequest, review_decision: 'APPROVED' }, { ...idle, enablingAutoMerge: true }, alice),
    ).toMatchObject({ id: 'merge', disabled: true })
  })

  it('monitors an enabled auto-merge and gives work actions a review alternative', () => {
    const recommendation = recommendedPullRequestAction(
      {
        ...pullRequest,
        review_decision: 'APPROVED',
        auto_merge_enabled: 1,
      },
      idle,
      alice,
    )

    expect(recommendation).toMatchObject({ id: 'details', label: 'Monitor auto-merge' })
    expect(alternatePullRequestAction({ id: 'work', label: 'Address feedback' })).toEqual({
      id: 'review',
      label: 'Review',
    })
  })

  it('groups the queue by the next useful decision', () => {
    const blocked = { ...pullRequest, number: 1, checks_failed: 1 } as PullRequest
    const review = { ...pullRequest, number: 2, review_decision: 'REVIEW_REQUIRED' } as PullRequest
    const ship = { ...pullRequest, number: 3, review_decision: 'APPROVED' } as PullRequest
    const waiting = { ...pullRequest, number: 4, review_decision: 'APPROVED', checks_pending: 2 } as PullRequest

    expect(pullRequestQueueGroup(blocked)).toBe('action')
    expect(groupPullRequestsForQueue([waiting, ship, review, blocked]).map((group) => group.id)).toEqual([
      'action',
      'review',
      'ship',
      'waiting',
    ])
  })

  it('uses the same review intent for an explicit or absent review decision', () => {
    expect(recommendedPullRequestAction({ ...pullRequest, review_decision: 'REVIEW_REQUIRED' }, idle, reviewer)).toMatchObject({
      id: 'details',
      label: 'Review changes',
    })
    expect(recommendedPullRequestAction({ ...pullRequest, review_decision: null }, idle, reviewer)).toMatchObject({
      id: 'details',
      label: 'Review changes',
    })
  })
})

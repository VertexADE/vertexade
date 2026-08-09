import { describe, expect, it } from 'vite-plus/test'
import type { ResolvedContextualAction } from './contextual-actions.ts'
import { reviewActionReady, selectedReviewAction } from './review-action-composer.ts'

const entity = { kind: 'pull-request', key: 'acme/widget#42', data: { head_sha: 'abc1234' } }

function action(overrides: Partial<ResolvedContextualAction>): ResolvedContextualAction {
  return {
    id: 'github.comment-on-pr-review',
    capabilityId: 'github.comment-review',
    label: 'Comment only',
    placements: ['pull-request.review'],
    entityKinds: ['pull-request'],
    moduleId: 'github',
    moduleName: 'GitHub',
    enabled: true,
    disabledReason: null,
    input: {},
    ...overrides,
  }
}

describe('review action composer', () => {
  it('starts with an eligible approval and falls back to a neutral decision before a warning decision', () => {
    const approval = action({ id: 'approve', label: 'Approve', tone: 'positive' })
    const requestChanges = action({ id: 'request', label: 'Request changes', tone: 'warning' })
    const comment = action({ id: 'comment', label: 'Comment only', tone: 'neutral' })

    expect(selectedReviewAction([approval, requestChanges, comment], '')).toBe(approval)
    approval.enabled = false
    expect(selectedReviewAction([approval, requestChanges, comment], '')).toBe(comment)
  })

  it('allows an optional approval comment but requires request-changes feedback', () => {
    const approval = action({
      id: 'approve',
      inputFields: [{ name: 'comment', label: 'Review comment', type: 'textarea', required: false }],
    })
    const requestChanges = action({
      id: 'request',
      inputFields: [{ name: 'comment', label: 'Required changes', type: 'textarea', required: true }],
    })

    expect(reviewActionReady(approval, entity, {}, '')).toBe(true)
    expect(reviewActionReady(requestChanges, entity, {}, '')).toBe(false)
    expect(reviewActionReady(requestChanges, entity, { comment: 'Add a regression test' }, '')).toBe(true)
  })

  it('retains typed confirmation semantics for contributed review actions', () => {
    const typed = action({ confirmation: { level: 'typed', confirmationField: 'head_sha' } })

    expect(reviewActionReady(typed, entity, {}, 'wrong')).toBe(false)
    expect(reviewActionReady(typed, entity, {}, 'abc1234')).toBe(true)
  })
})

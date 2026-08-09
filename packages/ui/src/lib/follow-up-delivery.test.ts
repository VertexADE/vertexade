import { describe, expect, it } from 'vite-plus/test'
import { canShowFollowUpComposer, followUpDelivery } from './follow-up-delivery.ts'

describe('follow-up composer visibility', () => {
  it('shows review replies in the activity-only Agent thread but not the review dialog', () => {
    const review = { thread_id: 'thread-1', kind: 'review' }
    expect(canShowFollowUpComposer(review, { activityOnly: true, needsInput: false })).toBe(true)
    expect(canShowFollowUpComposer(review, { activityOnly: false, needsInput: false })).toBe(false)
  })

  it('waits for a provider thread and pending input answers', () => {
    expect(canShowFollowUpComposer({ kind: 'task' }, { activityOnly: true, needsInput: false })).toBe(false)
    expect(canShowFollowUpComposer({ thread_id: 'thread-1', kind: 'task' }, { activityOnly: true, needsInput: true })).toBe(false)
  })
})

describe('follow-up delivery', () => {
  it('queues an active steerable turn by default', () => {
    expect(followUpDelivery({ status: 'running', can_steer: true })).toBe('queue')
  })

  it('steers only when explicitly requested', () => {
    expect(followUpDelivery({ status: 'running', can_steer: true }, 'steer')).toBe('steer')
  })

  it('uses the provider-neutral queue when live steering is unavailable', () => {
    expect(followUpDelivery({ status: 'starting', can_steer: false }, 'steer')).toBe('queue')
  })

  it('starts a normal follow-up after the current turn completed', () => {
    expect(followUpDelivery({ status: 'completed', can_steer: true }, 'queue')).toBe('follow-up')
  })
})

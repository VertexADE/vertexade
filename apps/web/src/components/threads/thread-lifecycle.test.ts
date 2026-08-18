import { describe, expect, it } from 'vite-plus/test'
import type { Job } from '@vertexade/ui/lib/dashboard-types'
import { matchesStatus, threadIsSnoozed } from './thread-components'

function thread(overrides: Partial<Job> = {}): Job {
  return {
    id: 1,
    status: 'completed',
    input_questions: null,
    queued_follow_up_count: 0,
    settled_at: null,
    snoozed_until: null,
    ...overrides,
  } as Job
}

describe('thread overview lifecycle', () => {
  const now = Date.parse('2026-08-17T10:00:00Z')

  it('hides settled threads from the overview while keeping them filterable', () => {
    const settled = thread({ settled_at: '2026-08-17T09:00:00Z' })

    expect(matchesStatus(settled, 'all', now)).toBe(false)
    expect(matchesStatus(settled, 'settled', now)).toBe(true)
  })

  it('returns snoozed threads to the overview after their deadline', () => {
    const snoozed = thread({ snoozed_until: '2026-08-17T11:00:00Z' })

    expect(threadIsSnoozed(snoozed, now)).toBe(true)
    expect(matchesStatus(snoozed, 'all', now)).toBe(false)
    expect(matchesStatus(snoozed, 'all', Date.parse('2026-08-17T12:00:00Z'))).toBe(true)
  })
})

import { describe, expect, it } from 'vite-plus/test'
import type { Job } from './dashboard-types'
import { sortThreadsByRecency } from './thread-recency'

function thread(id: number, activityAt: string | null, createdAt = '2026-07-01T10:00:00Z') {
  return { id, activity_at: activityAt, created_at: createdAt } as Job
}

describe('thread recency sorting', () => {
  const threads = [thread(1, '2026-07-24T10:00:00Z'), thread(2, '2026-07-26T10:00:00Z'), thread(3, null, '2026-07-25T10:00:00Z')]

  it('shows the most recently active thread first by default', () => {
    expect(sortThreadsByRecency(threads, 'recent').map(({ id }) => id)).toEqual([2, 3, 1])
  })

  it('supports oldest activity first without mutating the API result', () => {
    expect(sortThreadsByRecency(threads, 'oldest').map(({ id }) => id)).toEqual([1, 3, 2])
    expect(threads.map(({ id }) => id)).toEqual([1, 2, 3])
  })

  it('uses the thread id as a stable recency tie-breaker', () => {
    expect(
      sortThreadsByRecency([thread(4, '2026-07-26T10:00:00Z'), thread(8, '2026-07-26T10:00:00Z')], 'recent').map(({ id }) => id),
    ).toEqual([8, 4])
  })
})

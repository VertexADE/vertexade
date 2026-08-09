import { describe, expect, it } from 'vite-plus/test'
import type { Job } from './dashboard-types'
import { buildThreadSections, shouldCollapseThreadHistory, sortThreads, threadPriority, threadPriorityStats } from './thread-priority'

function thread(id: number, status: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    status,
    input_questions: null,
    activity_at: `2026-07-${String(10 + id).padStart(2, '0')}T10:00:00Z`,
    created_at: `2026-07-${String(10 + id).padStart(2, '0')}T09:00:00Z`,
    queued_follow_up_count: 0,
    ...overrides,
  } as Job
}

describe('thread priority', () => {
  it('puts human decisions ahead of recovery, active, queued, and historical work', () => {
    const threads = [
      thread(1, 'completed'),
      thread(2, 'running'),
      thread(3, 'completed', { queued_follow_up_count: 1 }),
      thread(4, 'failed'),
      thread(5, 'running', { input_questions: '[{"question":"Ship it?"}]' }),
    ]

    expect(sortThreads(threads, 'priority').map(({ id }) => id)).toEqual([5, 4, 2, 3, 1])
  })

  it('keeps the newest activity first inside each priority', () => {
    const older = thread(1, 'running', { activity_at: '2026-07-01T10:00:00Z' })
    const newer = thread(2, 'running', { activity_at: '2026-07-20T10:00:00Z' })

    expect(sortThreads([older, newer], 'priority').map(({ id }) => id)).toEqual([2, 1])
  })

  it('treats resumable and interrupted work as actionable', () => {
    expect(threadPriority(thread(1, 'resumable'))).toBe('action')
    expect(threadPriority(thread(2, 'interrupted'))).toBe('action')
  })

  it('builds only non-empty priority sections', () => {
    const sections = buildThreadSections([thread(1, 'completed'), thread(2, 'running')], 'priority')

    expect(sections.map(({ id }) => id)).toEqual(['active', 'history'])
  })

  it('reports attention and completion totals independently', () => {
    const stats = threadPriorityStats([
      thread(1, 'failed'),
      thread(2, 'running', { input_questions: '[{"question":"Continue?"}]' }),
      thread(3, 'completed'),
      thread(4, 'completed', { queued_follow_up_count: 1 }),
    ])

    expect(stats).toMatchObject({ input: 1, action: 1, attention: 2, queued: 1, completed: 1, history: 1 })
  })

  it('keeps history visible when it is the only useful result', () => {
    const history = [thread(1, 'completed'), thread(2, 'cancelled')]

    expect(shouldCollapseThreadHistory(history, false)).toBe(false)
    expect(shouldCollapseThreadHistory([...history, thread(3, 'running')], false)).toBe(true)
    expect(shouldCollapseThreadHistory([...history, thread(3, 'running')], true)).toBe(false)
  })
})

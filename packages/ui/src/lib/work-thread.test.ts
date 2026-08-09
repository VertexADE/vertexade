import { describe, expect, it } from 'vite-plus/test'
import type { WorkItem } from './dashboard-types'
import { splitWorkThreads, workThreadAction, workThreadCategory } from './work-thread'

type Thread = WorkItem['threads'][number]

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 1,
    status: 'completed',
    kind: 'task',
    thread_id: 'thread-1',
    agent_id: 'codex',
    task_title: 'Implement it',
    pr_number: 0,
    branch_name: 'feature/implement-it',
    head_sha: null,
    latest_activity: null,
    activity_at: null,
    created_at: '2026-07-21T00:00:00Z',
    finished_at: '2026-07-21T00:01:00Z',
    input_questions: null,
    linked_pr_number: null,
    full_name: 'example/api',
    ...overrides,
  }
}

describe('work thread presentation', () => {
  it.each(['review', 'work_review'] as const)('classifies %s as a review thread', (kind) => {
    expect(workThreadCategory(thread({ kind }))).toBe('review')
  })

  it.each(['task', 'review_handoff', 'pre_pr', 'stack_analysis', 'planning'] as const)('classifies %s as a work thread', (kind) => {
    expect(workThreadCategory(thread({ kind }))).toBe('work')
  })

  it('splits Work item jobs without changing their order', () => {
    const jobs = [thread({ id: 1 }), thread({ id: 2, kind: 'work_review' }), thread({ id: 3, kind: 'pre_pr' })]
    expect(splitWorkThreads(jobs)).toEqual({ work: [jobs[0], jobs[2]], review: [jobs[1]] })
  })

  it('makes continuation and review actions explicit', () => {
    expect(workThreadAction(thread())).toBe('Open & continue')
    expect(workThreadAction(thread({ status: 'running' }))).toBe('Open thread')
    expect(workThreadAction(thread({ kind: 'work_review' }))).toBe('Open review')
  })
})

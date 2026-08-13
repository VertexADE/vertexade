import { describe, expect, it } from 'vite-plus/test'
import type { JobLog } from './dashboard-types'
import { threadActivityEvents } from './thread-activity'

function job(overrides: Partial<JobLog> = {}) {
  return {
    events: [],
    result_text: 'Persisted result',
    agent_name: 'Codex',
    finished_at: '2026-08-05T14:20:52Z',
    activity_at: '2026-08-05T14:20:00Z',
    created_at: '2026-08-05T14:11:52Z',
    ...overrides,
  } as JobLog
}

describe('thread activity events', () => {
  it('renders the persisted result when the raw transcript is unavailable', () => {
    expect(threadActivityEvents(job({ prompt: 'Original request' }))).toEqual([
      {
        kind: 'user_message',
        title: 'You',
        text: 'Original request',
        time: '2026-08-05T14:11:52Z',
      },
      {
        kind: 'message',
        title: 'Codex',
        text: 'Persisted result',
        time: '2026-08-05T14:20:52Z',
        status: 'completed',
      },
    ])
  })

  it('keeps raw timeline events when they are available', () => {
    const events = [{ kind: 'action', title: 'Inspect', text: 'Checked files', time: null }]
    expect(threadActivityEvents(job({ events }))).toBe(events)
  })

  it('prepends a missing initial prompt without duplicating an existing user event', () => {
    const prompt = { kind: 'user_message', title: 'You', text: 'Original request', time: '2026-08-05T14:11:52Z' }
    const action = { kind: 'action', title: 'Inspect', text: 'Checked files', time: null }

    expect(threadActivityEvents(job({ prompt: 'Original request', events: [action] }))).toEqual([prompt, action])
    expect(threadActivityEvents(job({ prompt: 'Original request', events: [prompt, action] }))).toEqual([prompt, action])
  })
})

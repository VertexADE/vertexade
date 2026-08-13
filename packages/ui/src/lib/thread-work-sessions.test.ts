import { describe, expect, it } from 'vite-plus/test'
import type { TimelineEvent } from './agent-timeline'
import { buildThreadWorkSessions } from './thread-work-sessions'

const event = (key: string, kind: string, text: string, time: string): TimelineEvent => ({ key, kind, title: kind, text, time })

describe('thread work sessions', () => {
  it('groups each user request through completion and extracts the final response', () => {
    const sessions = buildThreadWorkSessions(
      [
        event('u1', 'user_message', 'Implement it', '2026-08-13T10:00:00Z'),
        event('a1', 'action', 'Inspected files', '2026-08-13T10:00:05Z'),
        event('m1', 'message', 'Done', '2026-08-13T10:01:00Z'),
        event('c1', 'completed', '', '2026-08-13T10:01:00Z'),
        event('u2', 'user_message', 'Refine it', '2026-08-13T10:02:00Z'),
        event('a2', 'action', 'Editing', '2026-08-13T10:02:10Z'),
      ],
      false,
    )

    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({ complete: true, duration: '1m', actions: 1, trigger: { key: 'u1' }, finalMessage: { key: 'm1' } })
    expect(sessions[0].activity.map(({ key }) => key)).toEqual(['a1'])
    expect(sessions[1]).toMatchObject({ complete: false, actions: 1, trigger: { key: 'u2' } })
  })

  it('treats the final persisted session as complete when the thread is complete', () => {
    const sessions = buildThreadWorkSessions(
      [event('u1', 'user_message', 'Question', '2026-08-13T10:00:00Z'), event('m1', 'message', 'Answer', '2026-08-13T10:00:03Z')],
      true,
    )
    expect(sessions[0]).toMatchObject({ complete: true, finalMessage: { key: 'm1' }, duration: 'a moment' })
  })
})

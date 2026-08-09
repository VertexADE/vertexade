import { describe, expect, it } from 'vite-plus/test'
import type { LogEvent } from './dashboard-types'
import { buildAgentTimeline, timelineSummary } from './agent-timeline'

const event = (value: Partial<LogEvent> & Pick<LogEvent, 'kind'>): LogEvent => ({
  title: '',
  text: '',
  time: null,
  ...value,
})

describe('agent activity timeline', () => {
  it('combines action start and completion while retaining duration', () => {
    const timeline = buildAgentTimeline([
      event({
        kind: 'action',
        title: 'Run tests',
        action_id: 'one',
        status: 'running',
        time: '2026-01-01T10:00:00Z',
      }),
      event({
        kind: 'action',
        title: 'Run tests',
        text: 'Passed',
        action_id: 'one',
        status: 'completed',
        time: '2026-01-01T10:00:03Z',
      }),
    ])
    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      title: 'Run tests',
      text: 'Passed',
      status: 'completed',
      duration_ms: 3_000,
      completed_at: '2026-01-01T10:00:03Z',
    })
  })

  it('collapses cumulative streaming messages without dropping distinct messages', () => {
    const timeline = buildAgentTimeline([
      event({ kind: 'message', title: 'ACP', text: 'Hello ', data: { streaming: true } }),
      event({ kind: 'message', title: 'ACP', text: 'Hello world', data: { streaming: true } }),
      event({ kind: 'action', title: 'Search', action_id: 'search', status: 'running' }),
      event({ kind: 'message', title: 'ACP', text: 'A separate answer' }),
    ])
    expect(timeline.map(({ text }) => text)).toEqual(['Hello world', '', 'A separate answer'])
    expect(timelineSummary(timeline)).toMatchObject({
      actions: 1,
      visible: 3,
      active: expect.objectContaining({ title: 'Search' }),
    })
  })

  it('keeps complete same-prefix agent messages when they are not streaming chunks', () => {
    const timeline = buildAgentTimeline([
      event({ kind: 'message', title: 'Codex', text: 'I reviewed the page.' }),
      event({
        kind: 'message',
        title: 'Codex',
        text: 'I reviewed the page. The implementation is now complete.',
      }),
    ])
    expect(timeline).toHaveLength(2)
  })

  it('never collapses user directions from the thread history', () => {
    const timeline = buildAgentTimeline([
      event({ kind: 'user_message', title: 'Your request', text: 'Improve the Work overview' }),
      event({
        kind: 'user_message',
        title: 'You continued the thread',
        text: 'Improve the Work overview and keep every message',
      }),
    ])
    expect(timeline.map(({ text }) => text)).toEqual(['Improve the Work overview', 'Improve the Work overview and keep every message'])
  })

  it('settles unfinished events when the persisted run has stopped', () => {
    const events = [event({ kind: 'action', title: 'Search', action_id: 'search', status: 'running' })]
    expect(buildAgentTimeline(events, 'completed')[0]?.status).toBe('completed')
    expect(buildAgentTimeline(events, 'failed')[0]?.status).toBe('interrupted')
    expect(buildAgentTimeline(events, 'resumable')[0]?.status).toBe('paused')
  })

  it('does not report historical activity as active for a waiting or terminal run', () => {
    const timeline = buildAgentTimeline([event({ kind: 'action', title: 'Search', action_id: 'search', status: 'running' })])
    expect(timelineSummary(timeline, 'running').active?.title).toBe('Search')
    expect(timelineSummary(timeline, 'waiting').active).toBeUndefined()
    expect(timelineSummary(timeline, 'completed').active).toBeUndefined()
  })

  it('keeps only the final completion marker after post-processing', () => {
    const timeline = buildAgentTimeline(
      [
        event({ kind: 'completed', title: 'Output ready', time: '2026-01-01T10:00:00Z' }),
        event({ kind: 'message', title: 'Summary', text: 'Final result', time: '2026-01-01T10:00:01Z' }),
        event({ kind: 'completed', title: 'Output ready', time: '2026-01-01T10:00:02Z' }),
      ],
      'completed',
    )

    expect(timeline.map(({ kind, time }) => [kind, time])).toEqual([
      ['message', '2026-01-01T10:00:01Z'],
      ['completed', '2026-01-01T10:00:02Z'],
    ])
  })
})

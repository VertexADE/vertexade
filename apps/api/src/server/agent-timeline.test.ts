import { describe, expect, it } from 'vite-plus/test'
import type { Agent } from '@vertexade/platform-contracts'
import { parseAgentLogEvents } from './agent-timeline.ts'

const agent = {
  id: 'example',
  name: 'Example',
  enabled: true,
  workspaceRoot: '/tmp',
  launch: () => ({ command: 'example', args: [] }),
} satisfies Agent

describe('agent timeline log parsing', () => {
  it('presents standard action lifecycles with stable identity and status', () => {
    const events = parseAgentLogEvents(
      [
        {
          time: '2026-01-01T10:00:00Z',
          event: 'action_started',
          action: {
            id: 'tool-1',
            title: 'npm test',
            kind: 'command',
            status: 'running',
            input: { command: 'npm test' },
          },
        },
        {
          time: '2026-01-01T10:00:02Z',
          event: 'action_completed',
          action: {
            id: 'tool-1',
            title: 'npm test',
            kind: 'command',
            status: 'completed',
            output: '12 tests passed',
          },
        },
      ]
        .map((value) => JSON.stringify(value))
        .join('\n'),
      agent,
    )
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'action',
        title: 'npm test',
        status: 'running',
        action_id: 'tool-1',
        action_kind: 'command',
      }),
      expect.objectContaining({
        kind: 'action',
        title: 'npm test',
        text: '12 tests passed',
        status: 'completed',
        action_id: 'tool-1',
      }),
    ])
  })

  it('keeps messages, plans, and completion in one chronological stream', () => {
    const events = parseAgentLogEvents(
      [
        {
          event: 'plan_updated',
          plan: { entries: [{ status: 'in_progress', step: 'Inspect the repository' }] },
        },
        { event: 'agent_message', text: 'I found the issue.' },
        { event: 'turn_completed', status: 'completed' },
      ]
        .map((value) => JSON.stringify(value))
        .join('\n'),
      agent,
    )
    expect(events.map(({ kind }) => kind)).toEqual(['plan', 'message', 'completed'])
    expect(events[0]?.text).toBe('[in_progress] Inspect the repository')
  })

  it('keeps initial and follow-up directions as full user messages', () => {
    const events = parseAgentLogEvents(
      [
        { event: 'user_message', text: 'Build the settings page', source: 'initial' },
        { event: 'agent_message', text: 'The first pass is ready.' },
        {
          event: 'follow_up_started',
          prompt: 'injected prompt',
          display_prompt: 'Make the layout responsive',
        },
        { event: 'agent_message', text: 'The responsive pass is ready.' },
      ]
        .map((value) => JSON.stringify(value))
        .join('\n'),
      agent,
    )
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'user_message',
        title: 'Your request',
        text: 'Build the settings page',
      }),
      expect.objectContaining({ kind: 'message', text: 'The first pass is ready.' }),
      expect.objectContaining({
        kind: 'user_message',
        title: 'You continued the thread',
        text: 'Make the layout responsive',
      }),
      expect.objectContaining({ kind: 'message', text: 'The responsive pass is ready.' }),
    ])
  })

  it('renders detected thread model context as an explicit timeline event', () => {
    const [event] = parseAgentLogEvents(
      JSON.stringify({
        event: 'thread_context_updated',
        model: 'gpt-5.6-sol',
        reasoning_effort: 'high',
      }),
      agent,
    )
    expect(event).toMatchObject({
      kind: 'progress',
      title: 'Thread settings detected',
      text: 'gpt-5.6-sol · high reasoning',
      status: 'completed',
    })
  })

  it('keeps structured per-file diff details for the timeline renderer', () => {
    const [event] = parseAgentLogEvents(
      JSON.stringify({
        event: 'diff_updated',
        diff: [
          'diff --git a/src/old.ts b/src/new.ts',
          'similarity index 90%',
          'rename to src/new.ts',
          '--- a/src/old.ts',
          '+++ b/src/new.ts',
          '-old',
          '+new',
        ].join('\n'),
      }),
      agent,
    )
    expect(event).toMatchObject({
      kind: 'changes',
      text: '1 file · +1 −1',
      data: {
        diff: expect.stringContaining('diff --git a/src/old.ts b/src/new.ts'),
        diff_summary: {
          additions: 1,
          deletions: 1,
          files: [{ path: 'src/new.ts', status: 'renamed', additions: 1, deletions: 1 }],
        },
      },
    })
  })
})

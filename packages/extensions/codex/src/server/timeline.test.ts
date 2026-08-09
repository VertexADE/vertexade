import { describe, expect, it } from 'vite-plus/test'
import { codexActionEvent } from './timeline.ts'

describe('Codex timeline events', () => {
  it('maps command lifecycle details into the shared action contract', () => {
    expect(
      codexActionEvent({ id: 'cmd-1', type: 'commandExecution', command: 'npm test', status: 'inProgress' }, 'started', 'thread-1'),
    ).toEqual({
      event: 'action_started',
      thread_id: 'thread-1',
      action: {
        id: 'cmd-1',
        title: 'npm test',
        kind: 'commandExecution',
        status: 'running',
        detail: 'inProgress',
        input: 'npm test',
      },
    })
    expect(
      codexActionEvent(
        {
          id: 'cmd-1',
          type: 'commandExecution',
          command: 'npm test',
          status: 'completed',
          aggregatedOutput: 'Passed',
        },
        'completed',
      ),
    ).toMatchObject({
      event: 'action_completed',
      action: { id: 'cmd-1', status: 'completed', output: 'Passed' },
    })
  })

  it('does not duplicate agent messages or private reasoning as actions', () => {
    expect(codexActionEvent({ type: 'agentMessage', text: 'Done' }, 'completed')).toBeNull()
    expect(codexActionEvent({ type: 'reasoning' }, 'started')).toBeNull()
  })
})

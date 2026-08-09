import { describe, expect, it } from 'vite-plus/test'
import type { JobLog, LogEvent } from './dashboard-types'
import { threadOutcome } from './thread-outcome'

const event = (name: string, status?: string, text = ''): LogEvent => ({
  kind: name === 'agent_message' ? 'message' : name === 'turn_completed' && status !== 'completed' ? 'error' : 'completed',
  title: name,
  text,
  time: `2026-07-20T12:00:0${status === 'failed' ? '4' : '1'}Z`,
  data: { event: name, ...(status ? { status } : {}) },
})

function job(status: string, events: LogEvent[], resultText = 'Completed task output', inputQuestions: string | null = null): JobLog {
  return { status, events, result_text: resultText, input_questions: inputQuestions } as JobLog
}

describe('threadOutcome', () => {
  it('preserves completed output when a later follow-up fails', () => {
    const outcome = threadOutcome(
      job('failed', [
        event('agent_message', undefined, 'Implemented and opened PR #191'),
        event('turn_completed', 'completed'),
        event('follow_up_started'),
        event('turn_completed', 'failed'),
      ]),
    )

    expect(outcome).toMatchObject({
      outputReady: true,
      followUp: 'failed',
      headline: 'Output ready · follow-up failed',
      tone: 'warning',
    })
  })

  it('shows that a follow-up is updating an existing result', () => {
    const outcome = threadOutcome(
      job('running', [
        event('agent_message', undefined, 'Initial output'),
        event('turn_completed', 'completed'),
        event('follow_up_started'),
      ]),
    )

    expect(outcome).toMatchObject({
      outputReady: true,
      followUp: 'running',
      headline: 'Updating completed output',
      tone: 'active',
    })
  })

  it('keeps a first-turn failure distinct from a failed follow-up', () => {
    const outcome = threadOutcome(job('failed', [event('turn_completed', 'failed')], ''))

    expect(outcome).toMatchObject({
      outputReady: false,
      followUp: 'none',
      headline: 'Run failed',
      tone: 'danger',
    })
  })

  it('shows input required instead of claiming the agent is working', () => {
    const outcome = threadOutcome(job('running', [], '', '[{"question":"Choose a target"}]'))

    expect(outcome).toMatchObject({
      outputReady: false,
      headline: 'Input required',
      tone: 'warning',
    })
  })

  it('shows a waiting follow-up while preserving completed output', () => {
    const outcome = threadOutcome(
      job(
        'running',
        [event('turn_completed', 'completed'), event('follow_up_started')],
        'Initial output',
        '[{"question":"Approve the change"}]',
      ),
    )

    expect(outcome).toMatchObject({
      outputReady: true,
      followUp: 'waiting',
      headline: 'Input required',
      tone: 'warning',
    })
  })

  it('does not show a resumable follow-up as running', () => {
    const outcome = threadOutcome(job('resumable', [event('turn_completed', 'completed'), event('follow_up_started')]))

    expect(outcome).toMatchObject({
      outputReady: true,
      followUp: 'paused',
      headline: 'Output ready · follow-up paused',
      tone: 'warning',
    })
  })

  it('recognizes preserved output when large-log trimming omits its message event', () => {
    const outcome = threadOutcome(
      job('completed', [event('turn_completed', 'completed'), event('follow_up_started'), event('turn_completed', 'completed')]),
    )

    expect(outcome).toMatchObject({
      outputReady: true,
      followUp: 'completed',
      headline: 'Updated output ready',
    })
  })

  it('recognizes completed provider output when the normalized log has no terminal event', () => {
    const value = job('completed', [], 'Provider review output')
    value.finished_at = '2026-07-22T12:00:00.000Z'
    expect(threadOutcome(value)).toMatchObject({
      outputReady: true,
      outputCompletedAt: '2026-07-22T12:00:00.000Z',
      headline: 'Output ready',
      tone: 'success',
    })
  })
})

import { describe, expect, it } from 'vite-plus/test'
import { agentIsWorking, agentNeedsInput, agentThreadLabel, agentThreadState } from './agent-thread-state'

const thread = (status: string, input_questions: string | null = null) => ({ status, input_questions })

describe('agent thread state', () => {
  it('shows an active input request as waiting instead of working', () => {
    const value = thread('running', '[{"question":"Choose a target"}]')
    expect(agentNeedsInput(value)).toBe(true)
    expect(agentThreadState(value)).toBe('waiting')
    expect(agentThreadLabel(agentThreadState(value))).toBe('Waiting for you')
    expect(agentIsWorking(agentThreadState(value))).toBe(false)
  })

  it('ignores empty and stale input payloads', () => {
    expect(agentThreadState(thread('running', '[]'))).toBe('running')
    expect(agentThreadState(thread('completed', '[{"question":"Stale"}]'))).toBe('completed')
  })

  it('does not invent a known state for an unsupported status', () => {
    expect(agentThreadState(thread('queued'))).toBe('unknown')
  })
})

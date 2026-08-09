import { describe, expect, it } from 'vite-plus/test'
import { agentThreadContext, mergeAgentThreadContext } from './thread-context.ts'

describe('agent thread context', () => {
  it('normalizes provider model and reasoning fields', () => {
    expect(agentThreadContext({ model: ' gpt-5.6-sol ', reasoning_effort: ' high ' })).toEqual({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    })
    expect(agentThreadContext({ effort: 'medium' })).toEqual({
      model: null,
      reasoningEffort: 'medium',
    })
    expect(agentThreadContext({ reasoningEffort: 'low' })).toEqual({
      model: null,
      reasoningEffort: 'low',
    })
  })

  it('ignores empty and non-string metadata', () => {
    expect(agentThreadContext({ model: '', reasoning_effort: null })).toBeNull()
    expect(agentThreadContext({ model: { id: 'gpt-5.6-sol' }, effort: 4 })).toBeNull()
  })

  it('preserves stored values when a provider reports only part of the context', () => {
    expect(
      mergeAgentThreadContext(
        { agent_model: 'stored-model', agent_reasoning_effort: 'low' },
        {
          model: null,
          reasoningEffort: 'high',
        },
      ),
    ).toEqual({ model: 'stored-model', reasoningEffort: 'high' })
  })
})

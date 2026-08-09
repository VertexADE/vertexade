import { describe, expect, it } from 'vite-plus/test'
import { loadedAgentOptions, optionsAfterAgentLoad, optionsForAgentChoice, reconcileAgentOptions } from './agent-options-picker'

const models = [
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    description: '',
    default_reasoning_effort: 'high',
    reasoning_efforts: [
      { id: 'high', description: '' },
      { id: 'xhigh', description: '' },
    ],
  },
]

describe('agent option reconciliation', () => {
  it('uses the immutable model and reasoning preset of a custom agent', () => {
    expect(
      optionsForAgentChoice(
        {
          id: 'custom-agent:reviewer',
          name: 'Reviewer',
          enabled: true,
          preset: { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
        },
        {
          agentId: 'custom-agent:reviewer',
          model: 'other',
          reasoningEffort: 'low',
          allowSubagents: true,
        },
      ),
    ).toEqual({
      agentId: 'custom-agent:reviewer',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      serviceTier: '',
      allowSubagents: true,
    })
  })
  it('clears a model and reasoning level that belong to another agent', () => {
    expect(
      reconcileAgentOptions(
        {
          agentId: 'codex',
          model: 'llm-proxy/umans-coder',
          reasoningEffort: 'medium',
          allowSubagents: true,
        },
        models,
      ),
    ).toEqual({
      agentId: 'codex',
      model: '',
      reasoningEffort: '',
      allowSubagents: true,
    })
  })

  it('uses the selected model default when its saved reasoning level is unavailable', () => {
    expect(
      reconcileAgentOptions({ agentId: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'medium', allowSubagents: true }, models),
    ).toEqual({
      agentId: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      allowSubagents: true,
    })
  })

  it('keeps valid agent-specific options unchanged', () => {
    const current = {
      agentId: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
      allowSubagents: true,
    }
    expect(reconcileAgentOptions(current, models)).toBe(current)
  })

  it('preserves settings loaded while the provider request was in flight', () => {
    const loaded = {
      agentId: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
      allowSubagents: true,
    }
    expect(
      optionsAfterAgentLoad(loaded, { id: 'codex', name: 'Codex', enabled: true }, models, {
        agentId: 'codex',
        model: '',
        reasoningEffort: '',
        allowSubagents: false,
      }),
    ).toBe(loaded)
  })

  it('ignores a stale response after the provider changes', () => {
    expect(
      loadedAgentOptions(
        { agentId: 'opencode', model: '', reasoningEffort: '', allowSubagents: false },
        {
          agent: { id: 'codex', name: 'Codex' },
          agents: [],
          models,
        },
        { agentId: 'codex', model: '', reasoningEffort: '', allowSubagents: false },
      ),
    ).toBeNull()
  })
})

import { describe, expect, it } from 'vite-plus/test'
import { resolveThreadRuntime, threadRuntimeDefaults } from './runtime-settings.ts'

const settings = (value: unknown) => ({ read: () => value }) as any

describe('thread runtime defaults', () => {
  it('falls back to the active provider and keeps work and review choices separate', () => {
    expect(threadRuntimeDefaults(settings({ review: { agentId: 'claude', model: 'opus', reasoningEffort: 'high' } }), 'codex')).toEqual({
      workItem: { agentId: 'codex', model: '', reasoningEffort: '', serviceTier: '' },
      review: { agentId: 'claude', model: 'opus', reasoningEffort: 'high', serviceTier: '' },
    })
  })

  it('lets an explicit thread runtime override its category default', () => {
    const store = settings({ workItem: { agentId: 'codex', model: 'gpt-default', reasoningEffort: 'medium' } })
    expect(resolveThreadRuntime(store, 'codex', 'workItem', { model: 'gpt-explicit' })).toEqual({
      agentId: 'codex',
      model: 'gpt-explicit',
      reasoningEffort: 'medium',
      serviceTier: '',
    })
  })
})

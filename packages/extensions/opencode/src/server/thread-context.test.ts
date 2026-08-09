import { describe, expect, it } from 'vite-plus/test'
import { openCodeThreadContext } from './thread-context.ts'

describe('OpenCode thread context', () => {
  it('detects the latest durable provider, model, and variant', () => {
    expect(openCodeThreadContext([{ role: 'assistant', providerID: 'openai', modelID: 'gpt-5.6', variant: 'high' }])).toEqual({
      model: 'openai/gpt-5.6',
      reasoning_effort: 'high',
    })
    expect(
      openCodeThreadContext([
        {
          role: 'user',
          model: { providerID: 'anthropic', modelID: 'claude-sonnet', variant: 'max' },
        },
      ]),
    ).toEqual({ model: 'anthropic/claude-sonnet', reasoning_effort: 'max' })
  })

  it('uses launch context only for fields the durable thread omits', () => {
    expect(
      openCodeThreadContext([{ providerID: 'openai', modelID: 'gpt-5.6' }], {
        model: 'fallback/model',
        reasoning_effort: 'medium',
      }),
    ).toEqual({ model: 'openai/gpt-5.6', reasoning_effort: 'medium' })
  })
})

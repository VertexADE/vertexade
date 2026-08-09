import { describe, expect, it } from 'vite-plus/test'
import { resolveEphemeralLaunch } from './ephemeral.ts'

describe('ephemeral agent launches', () => {
  const supported = { name: 'Codex', supportsEphemeral: true }
  const unsupported = { name: 'OpenCode', supportsEphemeral: false }

  it('uses the workflow default only when the provider supports it', () => {
    expect(resolveEphemeralLaunch(supported, undefined, true)).toBe(true)
    expect(resolveEphemeralLaunch(unsupported, undefined, true)).toBe(false)
  })

  it('allows an explicit persistent run', () => {
    expect(resolveEphemeralLaunch(supported, false, true)).toBe(false)
  })

  it('rejects an unsupported or malformed explicit request', () => {
    expect(() => resolveEphemeralLaunch(unsupported, true)).toThrow('OpenCode does not support ephemeral runs')
    expect(() => resolveEphemeralLaunch(supported, 'true')).toThrow('ephemeral must be a boolean')
  })
})

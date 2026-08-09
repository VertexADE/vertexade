import { describe, expect, it } from 'vite-plus/test'
import { resolveSubagentLaunch } from './subagents.ts'

describe('sub-agent launch permissions', () => {
  it('keeps orchestration disabled unless it is explicitly requested', () => {
    expect(resolveSubagentLaunch({ name: 'Codex', subagentOrchestration: 'native' }, undefined)).toBe(false)
    expect(resolveSubagentLaunch({ name: 'Codex', subagentOrchestration: 'native' }, false)).toBe(false)
  })

  it('allows declared native and harness delegation', () => {
    expect(resolveSubagentLaunch({ name: 'Codex', subagentOrchestration: 'native' }, true)).toBe(true)
    expect(resolveSubagentLaunch({ name: 'Gemini ACP', subagentOrchestration: 'harness' }, true)).toBe(true)
  })

  it('rejects invalid or unsupported requests', () => {
    expect(() => resolveSubagentLaunch({ name: 'Legacy agent' }, true)).toThrow('does not support sub-agent')
    expect(() => resolveSubagentLaunch({ name: 'Codex', subagentOrchestration: 'native' }, 'true')).toThrow('must be a boolean')
  })
})

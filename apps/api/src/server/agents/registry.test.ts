import { describe, expect, it } from 'vite-plus/test'
import { AgentRegistry } from './registry.ts'

describe('AgentRegistry', () => {
  it('registers and selects agent implementations', () => {
    const registry = new AgentRegistry()
    registry.forModule('codex').register({
      id: 'codex',
      name: 'Codex',
      enabled: true,
      workspaceRoot: '/tmp/codex',
      launch: () => ({ command: 'codex', args: [] }),
    })
    expect(registry.require('codex').launch({})).toEqual({ command: 'codex', args: [] })
    expect(registry.capabilities()).toEqual([
      {
        id: 'codex',
        name: 'Codex',
        enabled: true,
        supportsLiveSteering: false,
        supportsCustomEnvironment: false,
        supportsReadOnlyMode: false,
        supportsEphemeral: false,
        supportsSubagents: false,
        subagentOrchestration: 'none',
        supportsPlatformSubagents: false,
        platformSubagentOrchestration: 'none',
        selectable: true,
        moduleId: 'codex',
      },
    ])
    expect(registry.moduleId('codex')).toBe('codex')
    expect(registry.declarations('codex')).toEqual(['codex'])
    registry.unregister('codex')
    expect(registry.get('codex')).toBeNull()
  })

  it('only lets a scoped registry unregister its own agents', () => {
    const registry = new AgentRegistry()
    const implementation = (id: string) => ({
      id,
      name: id,
      enabled: true,
      workspaceRoot: `/tmp/${id}`,
      launch: () => ({ command: id, args: [] }),
    })
    registry.register('other', implementation('other'))
    const scoped = registry.forModule('acp')
    scoped.register(implementation('acp'))
    scoped.unregister('other')
    expect(registry.get('other')?.id).toBe('other')
    scoped.unregister('acp')
    expect(registry.get('acp')).toBeNull()
  })

  it('rejects missing agents and agents disabled directly or through their extension', () => {
    const enabled = new Set(['future'])
    const registry = new AgentRegistry((moduleId) => enabled.has(moduleId))
    registry.forModule('future').register({
      id: 'future',
      name: 'Future',
      enabled: false,
      workspaceRoot: '/tmp/future',
      launch: () => ({ command: 'future', args: [] }),
    })
    expect(() => registry.require('future')).toThrow('Future agent is disabled')
    expect(() => registry.require('codex')).toThrow('Unknown agent: codex')
    registry.forModule('codex').register({
      id: 'codex',
      name: 'Codex',
      enabled: true,
      workspaceRoot: '/tmp/codex',
      launch: () => ({ command: 'codex', args: [] }),
    })
    expect(() => registry.require('codex')).toThrow('Codex agent is disabled')
  })
})

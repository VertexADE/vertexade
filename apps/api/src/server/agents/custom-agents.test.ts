import { describe, expect, it } from 'vite-plus/test'
import { CustomAgentSynchronizer, customAgent } from './custom-agents.ts'
import { AgentRegistry } from './registry.ts'

describe('custom agents', () => {
  it('delegates to the base runtime with its fixed model and reasoning preset', () => {
    const profile = {
      id: 'reviewer',
      name: 'Security reviewer',
      description: '',
      agentId: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      promptPrefix: '',
      skillIds: [],
      mcpServerIds: [],
    }
    const agent = customAgent(
      {
        id: 'codex',
        name: 'Codex',
        enabled: true,
        workspaceRoot: '/tmp/codex',
        launch: (options) => ({
          command: 'codex',
          args: [String(options.model), String(options.reasoningEffort)],
        }),
      },
      profile,
    )
    expect(agent.id).toBe('custom-agent:reviewer')
    expect(agent.preset).toEqual({ model: 'gpt-5.6-sol', reasoningEffort: 'high' })
    expect(agent.launch({ model: 'other', reasoningEffort: 'low' })).toEqual({
      command: 'codex',
      args: ['gpt-5.6-sol', 'high'],
    })
    expect(agent.parseLaunchOptions?.({})).toEqual(agent.preset)
  })

  it('synchronizes active and retired profiles without breaking existing threads', () => {
    const profiles = [
      {
        id: 'reviewer',
        name: 'Reviewer',
        description: '',
        agentId: 'codex',
        model: '',
        reasoningEffort: '',
        promptPrefix: '',
        skillIds: [],
        mcpServerIds: [],
        archived: false,
      },
    ]
    const agents = new AgentRegistry()
    agents.register('codex', {
      id: 'codex',
      name: 'Codex',
      enabled: true,
      workspaceRoot: '/tmp/codex',
      launch: () => ({ command: 'codex', args: [] }),
    })
    const synchronizer = new CustomAgentSynchronizer(agents, { profiles: () => profiles } as any)
    synchronizer.sync()
    expect(agents.require('custom-agent:reviewer').name).toBe('Reviewer')
    profiles[0]!.archived = true
    synchronizer.sync()
    expect(agents.require('custom-agent:reviewer').selectable).toBe(false)
  })
})

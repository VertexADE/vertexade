import { describe, expect, it } from 'vite-plus/test'
import { createAcpAgent } from './agent.ts'
import type { AcpHarnessConfiguration } from './config.ts'

const harness = (overrides: Partial<AcpHarnessConfiguration> = {}): AcpHarnessConfiguration => ({
  id: 'gemini',
  name: 'Gemini ACP',
  command: 'agent-cli',
  args: ['acp', '--flag'],
  permissionPolicy: 'approve',
  active: true,
  environment: { TOKEN: 'secret' },
  ...overrides,
})

describe('ACP agent adapter', () => {
  it('creates a distinct selectable runtime for a configured harness', () => {
    const agent = createAcpAgent({ harnessId: 'gemini', configuration: () => harness() })
    const launch = agent.launch({
      cwd: '/tmp/worktree',
      prompt: 'Review this',
      resume: 'session-1',
      reviewMode: true,
    })
    expect(agent).toMatchObject({ id: 'acp:gemini', name: 'Gemini ACP', selectable: true })
    expect(agent.subagentOrchestration).toBe('harness')
    expect(agent.environment?.()).toEqual({ TOKEN: 'secret' })
    expect(launch.command).toBe(process.execPath)
    expect(launch.env).toEqual({ VERTEXADE_MCP_SERVERS: '[]' })
    expect(launch.args).toEqual(
      expect.arrayContaining(['--command', 'agent-cli', '--agent-arg', 'acp', '--resume', 'session-1', '--review-mode']),
    )
    expect(launch.args.at(-1)).toBe('--review-mode')
  })

  it('passes delegation permission to the configured ACP harness', () => {
    const launch = createAcpAgent({ harnessId: 'gemini', configuration: () => harness() }).launch({
      cwd: '/tmp/worktree',
      prompt: 'Implement this',
      allowSubagents: true,
    })
    expect(launch.args).toContain('--allow-subagents')
  })

  it('keeps paused and archived runtimes registered but unavailable for new selection', () => {
    expect(
      createAcpAgent({
        harnessId: 'paused',
        configuration: () => harness({ id: 'paused', active: false }),
      }).selectable,
    ).toBe(false)
    expect(
      createAcpAgent({
        harnessId: 'archived',
        configuration: () => harness({ id: 'archived', archived: true }),
      }).enabled,
    ).toBe(true)
  })

  it('requires an administrator-configured command', () => {
    const agent = createAcpAgent({
      harnessId: 'default',
      configuration: () => harness({ id: 'default', command: '' }),
    })
    expect(() => agent.launch({ cwd: '/tmp', prompt: 'hello' })).toThrow('Configure the Gemini ACP harness')
  })
})

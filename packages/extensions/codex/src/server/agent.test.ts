import { access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vite-plus/test'
import { codexConfigDefaults, createCodexAgent } from './agent.ts'

describe('Codex agent', () => {
  it('advertises live turn steering', () => {
    expect(createCodexAgent({ run: vi.fn() }).supportsLiveSteering).toBe(true)
  })

  it('only applies worktree-local Git configuration to Git workspaces', async () => {
    const run = vi.fn()
    const agent = createCodexAgent({ run })

    await agent.prepareWorkspace?.({ path: '/work/directory', sourceKind: 'directory', strategy: 'direct' })
    expect(run).not.toHaveBeenCalled()

    await agent.prepareWorkspace?.({ path: '/work/repository', sourceKind: 'git', strategy: 'worktree' })
    expect(run).toHaveBeenCalledWith('git', [
      '-C',
      '/work/repository',
      'config',
      '--worktree',
      'codex.localEnvironmentConfigPath',
      '__none__',
    ])
  })

  it('reads the configured default model for stable follow-up turns', () => {
    expect(codexConfigDefaults(`personality = "pragmatic"\nmodel = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"`)).toEqual({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    })
  })

  it('forwards full-access automation permissions to the thread launcher', () => {
    const agent = createCodexAgent({ run: vi.fn() })
    expect(agent.launch({ cwd: '/work', base: '/repo', prompt: 'ship it', permissionMode: 'full' })).toEqual({
      command: process.execPath,
      args: [
        '--import',
        import.meta.resolve('tsx'),
        expect.stringMatching('/packages/extensions/codex/src/server/start-thread\\.ts$'),
        '--cwd',
        '/work',
        '--base',
        '/repo',
        '--prompt',
        'ship it',
        '--full-access',
      ],
      env: { VERTEXADE_MCP_SERVERS: '[]' },
    })
  })

  it('uses a no-approval read-only sandbox for generated text', () => {
    const agent = createCodexAgent({ run: vi.fn() })
    const launch = agent.launch({
      cwd: '/work',
      base: '/repo',
      prompt: 'generate a title',
      permissionMode: 'read-only',
    })
    expect(launch.args).toContain('--read-only')
    const result = spawnSync(launch.command, [...launch.args, '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, ...launch.env },
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      event: 'dry_run',
      threadParams: { approvalPolicy: 'never', sandbox: 'read-only', config: { mcp_servers: {} } },
    })
  })

  it('supplies an explicit empty MCP configuration instead of inheriting global servers', () => {
    const launch = createCodexAgent({ run: vi.fn() }).launch({
      cwd: '/work',
      base: '/repo',
      prompt: 'ship it',
    })
    const result = spawnSync(launch.command, [...launch.args, '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, ...launch.env },
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      event: 'dry_run',
      threadParams: { config: { mcp_servers: {} } },
    })
  })

  it('starts an ephemeral app-server thread when requested', () => {
    const agent = createCodexAgent({ run: vi.fn() })
    expect(agent.supportsEphemeral).toBe(true)
    const launch = agent.launch({
      cwd: '/work',
      base: '/repo',
      prompt: 'review it',
      ephemeral: true,
    })
    expect(launch.args).toContain('--ephemeral')
    const result = spawnSync(launch.command, [...launch.args, '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, ...launch.env },
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      event: 'dry_run',
      threadParams: { ephemeral: true },
    })
  })

  it('uses normal speed by default and forwards Fast as the priority service tier', () => {
    const agent = createCodexAgent({ run: vi.fn() })
    const normal = agent.launch({ cwd: '/work', base: '/repo', prompt: 'normal' })
    expect(normal.args).not.toContain('--service-tier')
    const fast = agent.launch({ cwd: '/work', base: '/repo', prompt: 'fast', serviceTier: 'priority' })
    expect(fast.args).toContain('--service-tier')
    const result = spawnSync(fast.command, [...fast.args, '--dry-run'], { encoding: 'utf8', env: { ...process.env, ...fast.env } })
    expect(JSON.parse(result.stdout)).toMatchObject({ threadParams: { serviceTier: 'priority' }, serviceTier: 'priority' })
  })

  it('enables the native collaboration tool only when sub-agents are allowed', () => {
    const agent = createCodexAgent({ run: vi.fn() })
    const launch = agent.launch({
      cwd: '/work',
      base: '/repo',
      prompt: 'ship it',
      allowSubagents: true,
    })
    expect(agent.subagentOrchestration).toBe('native')
    expect(launch.args).toContain('--allow-subagents')
    const result = spawnSync(launch.command, [...launch.args, '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, ...launch.env },
    })
    expect(JSON.parse(result.stdout)).toMatchObject({
      threadParams: { config: { features: { multi_agent: true } } },
    })
  })

  it('resolves the launcher from the monorepo root to an existing file', async () => {
    const agent = createCodexAgent({ run: vi.fn() })
    const launch = agent.launch({ cwd: '/work', base: '/repo', prompt: 'ship it' })
    await expect(access(launch.args[2])).resolves.toBeUndefined()
  })

  it('forwards shared Work memory as an additional writable root', () => {
    const agent = createCodexAgent({ run: vi.fn() })
    expect(
      agent.launch({
        cwd: '/work',
        base: '/repo',
        prompt: 'ship it',
        writableRoots: ['/data/work-memory/W-0001'],
      }).args,
    ).toContain('/data/work-memory/W-0001')
    expect(
      agent.launch({
        cwd: '/work',
        base: '/repo',
        prompt: 'ship it',
        writableRoots: ['/data/work-memory/W-0001'],
      }).args,
    ).toContain('--writable-root')
  })
})

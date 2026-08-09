import { describe, expect, it, vi } from 'vite-plus/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { createOpenCodeAgent, openCodeMcpServers } from './agent.ts'

describe('OpenCode agent', () => {
  it('maps platform MCP transports to OpenCode local and remote servers', () => {
    expect(
      openCodeMcpServers([
        {
          id: 'one',
          name: 'local',
          transport: 'stdio',
          command: 'npx',
          args: ['server'],
          env: { TOKEN: 'secret' },
          defaultEnabled: true,
        },
        {
          id: 'two',
          name: 'remote',
          transport: 'sse',
          url: 'https://mcp.example/sse',
          headers: { Authorization: 'token' },
          defaultEnabled: false,
        },
      ]),
    ).toEqual({
      local: {
        type: 'local',
        command: ['npx', 'server'],
        enabled: true,
        environment: { TOKEN: 'secret' },
      },
      remote: {
        type: 'remote',
        url: 'https://mcp.example/sse',
        enabled: true,
        headers: { Authorization: 'token' },
      },
    })
  })
  it('prepares generated worktrees by trusting their mise config', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'opencode-agent-'))
    await writeFile(join(worktree, 'mise.toml'), '[tools]\nnode = "22"\n')
    const run = vi.fn().mockResolvedValue('')
    const agent = createOpenCodeAgent({ run, env: {} })
    await agent.prepareWorkspace?.(worktree)
    expect(run).toHaveBeenCalledWith('gh', ['--version'], { env: {} })
    expect(run).toHaveBeenCalledWith('gh', ['auth', 'status', '--active'], { env: {} })
    expect(run).toHaveBeenCalledWith('fallow', ['--version'], { env: {} })
    expect(run).toHaveBeenCalledWith('mise', ['trust', '--yes', join(worktree, 'mise.toml')])
    await rm(worktree, { recursive: true })
  })

  it('uses GH_TOKEN without requiring a separate gh auth profile', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'opencode-agent-token-'))
    const run = vi.fn().mockResolvedValue('')
    const agent = createOpenCodeAgent({ run, env: { GH_TOKEN: 'test-token' } })
    await agent.prepareWorkspace?.(worktree)
    expect(run).not.toHaveBeenCalledWith('gh', ['auth', 'status', '--active'], {
      env: { GH_TOKEN: 'test-token' },
    })
    await rm(worktree, { recursive: true })
  })

  it('maps launch options to the documented CLI lifecycle', () => {
    const agent = createOpenCodeAgent({
      run: vi.fn(),
      env: { PATH: '/tools', HOME: '/agent', GH_CONFIG_DIR: '/gh', GH_TOKEN: 'test-token' },
    })
    expect(agent.supportsLiveSteering).toBe(true)
    const launch = agent.launch({
      cwd: '/work',
      prompt: 'ship it',
      resume: 'ses_123',
      model: 'openai/gpt-5',
      reasoningEffort: 'high',
    })
    expect(launch).toEqual({
      command: process.execPath,
      args: expect.arrayContaining([
        '--cwd',
        '/work',
        '--prompt',
        'ship it',
        '--resume',
        'ses_123',
        '--model',
        'openai/gpt-5',
        '--reasoning-effort',
        'high',
      ]),
      env: {
        PATH: '/tools',
        HOME: '/agent',
        GH_CONFIG_DIR: '/gh',
        GH_TOKEN: 'test-token',
        OPENCODE_PERMISSION: '{"*":"allow","task":"deny"}',
        OPENCODE_CONFIG_CONTENT: expect.stringContaining('/packages/extensions/opencode/src/server/skills'),
      },
    })
  })

  it('allows every permission and enables LSP for every run', () => {
    const agent = createOpenCodeAgent({ run: vi.fn(), env: {} })
    expect(agent.launch({ cwd: '/work', prompt: 'ship it', permissionMode: 'full' })).toEqual({
      command: process.execPath,
      args: expect.arrayContaining(['--cwd', '/work', '--prompt', 'ship it']),
      env: {
        OPENCODE_PERMISSION: '{"*":"allow","task":"deny"}',
        OPENCODE_CONFIG_CONTENT: expect.stringContaining('/packages/extensions/opencode/src/server/skills'),
      },
    })
  })

  it('denies every tool permission for read-only generation', () => {
    const agent = createOpenCodeAgent({ run: vi.fn(), env: {} })
    const launch = agent.launch({
      cwd: '/work',
      prompt: 'generate a title',
      permissionMode: 'read-only',
    })
    expect(agent.supportsReadOnlyMode).toBe(true)
    expect(launch.args).toEqual(expect.arrayContaining(['--permission-mode', 'read-only']))
    expect(launch.env).toMatchObject({ OPENCODE_PERMISSION: '{"*":"deny","task":"deny"}' })
  })

  it('exposes the native task tool only when sub-agents are allowed', () => {
    const agent = createOpenCodeAgent({ run: vi.fn(), env: {} })
    const launch = agent.launch({ cwd: '/work', prompt: 'ship it', allowSubagents: true })
    expect(agent.subagentOrchestration).toBe('native')
    expect(launch.args).toContain('--allow-subagents')
    expect(launch.env).toMatchObject({ OPENCODE_PERMISSION: '{"*":"allow","task":"allow"}' })
  })

  it('normalizes OpenCode JSON events into the host event contract', () => {
    const agent = createOpenCodeAgent({ run: vi.fn() })
    const timestamp = 1_784_449_843_101
    const time = new Date(timestamp).toISOString()
    expect(agent.normalizeEvent?.({ type: 'step_start', sessionID: 'ses_123', timestamp })).toEqual({
      event: 'turn_started',
      thread_id: 'ses_123',
      title: 'OpenCode is working',
      time,
    })
    expect(
      agent.normalizeEvent?.({
        type: 'text',
        sessionID: 'ses_123',
        timestamp,
        part: { text: 'Done' },
      }),
    ).toEqual({ event: 'agent_message', thread_id: 'ses_123', text: 'Done', time })
    expect(
      agent.normalizeEvent?.({
        type: 'tool_use',
        sessionID: 'ses_123',
        timestamp,
        part: {
          id: 'tool-1',
          tool: 'bash',
          state: { status: 'completed', input: { command: 'npm test' }, output: 'Passed' },
        },
      }),
    ).toEqual({
      event: 'action_completed',
      thread_id: 'ses_123',
      time,
      action: {
        id: 'tool-1',
        title: 'npm test',
        kind: 'bash',
        status: 'completed',
        input: { command: 'npm test' },
        output: 'Passed',
      },
    })
    expect(
      agent.normalizeEvent?.({
        type: 'step_finish',
        sessionID: 'ses_123',
        timestamp,
        part: { reason: 'tool-calls' },
      }),
    ).toEqual({
      event: 'step_completed',
      thread_id: 'ses_123',
      status: 'continuing',
      reason: 'tool-calls',
      time,
    })
    expect(
      agent.normalizeEvent?.({
        type: 'step_finish',
        sessionID: 'ses_123',
        timestamp,
        part: { reason: 'stop' },
      }),
    ).toEqual({
      event: 'turn_completed',
      thread_id: 'ses_123',
      status: 'completed',
      reason: 'stop',
      time,
    })
    expect(
      agent.normalizeEvent?.({
        type: 'error',
        sessionID: 'ses_123',
        error: {
          name: 'APIError',
          data: { message: 'Rate limited', statusCode: 429, isRetryable: true },
        },
      }),
    ).toMatchObject({
      event: 'error',
      thread_id: 'ses_123',
      message: 'Rate limited',
      statusCode: 429,
      retryable: true,
    })
  })

  it('detects completed sessions from the durable OpenCode database', async () => {
    const dataHome = await mkdtemp(join(tmpdir(), 'opencode-data-'))
    const directory = join(dataHome, 'opencode')
    await mkdir(directory)
    const database = new DatabaseSync(join(directory, 'opencode.db'))
    database.exec(
      'CREATE TABLE session (id TEXT PRIMARY KEY); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT); CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER, data TEXT)',
    )
    database.prepare('INSERT INTO session (id) VALUES (?)').run('ses_done')
    database
      .prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)')
      .run('msg_done', 'ses_done', 1000, 2500, JSON.stringify({ role: 'assistant', finish: 'stop', time: { completed: 2500 } }))
    database
      .prepare('INSERT INTO part VALUES (?, ?, ?, ?)')
      .run('part_done', 'msg_done', 2000, JSON.stringify({ type: 'text', text: 'Finished cleanly' }))
    database.close()
    const agent = createOpenCodeAgent({ run: vi.fn(), env: { XDG_DATA_HOME: dataHome } })
    await expect(agent.completedThreadSnapshot?.('ses_done')).resolves.toEqual({
      message: 'Finished cleanly',
      completedAt: 2,
    })
    await expect(agent.completedThreadSnapshot?.('missing')).resolves.toBeNull()
    await rm(dataHome, { recursive: true })
  })

  it('detects whether a stopped session can be resumed', async () => {
    const run = vi.fn().mockResolvedValue('{"info":{"id":"ses_123"}}')
    const agent = createOpenCodeAgent({
      run,
      env: { XDG_DATA_HOME: join(tmpdir(), 'missing-opencode-data') },
    })
    await expect(agent.resumableThreadExists?.('ses_123')).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith('opencode', ['export', 'ses_123', '--sanitize'])
    run.mockRejectedValueOnce(new Error('Session not found'))
    await expect(agent.resumableThreadExists?.('missing')).resolves.toBe(false)
  })
})

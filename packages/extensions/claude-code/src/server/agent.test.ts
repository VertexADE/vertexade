import { describe, expect, it, vi } from 'vite-plus/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createClaudeCodeAgent } from './agent.ts'

describe('Claude Code agent', () => {
  it('checks authentication and prepares mise-enabled worktrees', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'claude-code-agent-'))
    const home = await mkdtemp(join(tmpdir(), 'claude-code-home-'))
    const fallowRoot = join(home, 'fallow')
    const bin = join(fallowRoot, 'bin')
    const skill = join(fallowRoot, 'skills', 'fallow')
    await mkdir(join(skill, 'references'), { recursive: true })
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'fallow'), '#!/bin/sh\n', { mode: 0o755 })
    await writeFile(join(skill, 'SKILL.md'), '# Fallow\n')
    await writeFile(join(skill, 'references', 'cli-reference.md'), '# CLI\n')
    await writeFile(join(worktree, 'mise.toml'), '[tools]\nnode = "22"\n')
    const run = vi.fn().mockResolvedValue('')
    const environment = { HOME: home, PATH: bin }
    const agent = createClaudeCodeAgent({ run, env: environment })
    await agent.prepareWorkspace?.({ path: worktree, sourceKind: 'git', strategy: 'worktree' })
    expect(run).toHaveBeenCalledWith('claude', ['--version'], { env: environment })
    expect(run).toHaveBeenCalledWith('gh', ['--version'], { env: environment })
    expect(run).toHaveBeenCalledWith('fallow', ['--version'], { env: environment })
    expect(run).toHaveBeenCalledWith('mise', ['trust', '--yes', join(worktree, 'mise.toml')])
    await expect(readFile(join(home, '.claude', 'skills', 'fallow', 'SKILL.md'), 'utf8')).resolves.toBe('# Fallow\n')
    await expect(readFile(join(home, '.claude', 'skills', 'fallow', 'references', 'cli-reference.md'), 'utf8')).resolves.toBe('# CLI\n')
    await rm(worktree, { recursive: true })
    await rm(home, { recursive: true })
  })

  it('finds the Fallow skill beside a mise npm executable shim', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'claude-code-agent-'))
    const home = await mkdtemp(join(tmpdir(), 'claude-code-home-'))
    const nodeModules = join(home, 'mise', 'node_modules')
    const bin = join(nodeModules, '.bin')
    const skill = join(nodeModules, 'fallow', 'skills', 'fallow')
    await mkdir(bin, { recursive: true })
    await mkdir(skill, { recursive: true })
    await writeFile(join(bin, 'fallow'), '#!/bin/sh\n', { mode: 0o755 })
    await writeFile(join(skill, 'SKILL.md'), '# Fallow from npm\n')
    const environment = { HOME: home, PATH: bin }
    const agent = createClaudeCodeAgent({ run: vi.fn().mockResolvedValue(''), env: environment })

    await agent.prepareWorkspace?.({ path: worktree, sourceKind: 'git', strategy: 'worktree' })

    await expect(readFile(join(home, '.claude', 'skills', 'fallow', 'SKILL.md'), 'utf8')).resolves.toBe('# Fallow from npm\n')
    await rm(worktree, { recursive: true })
    await rm(home, { recursive: true })
  })

  it('maps task, review, full-access, resume, and fork launches', () => {
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: {} })
    expect(agent.supportsLiveSteering).toBe(true)
    const resume = agent.launch({
      cwd: '/work',
      prompt: 'ship it',
      resume: 'session-1',
      model: 'sonnet',
      reasoningEffort: 'high',
    })
    expect(resume.command).toBe(process.execPath)
    expect(resume.env).toEqual({ VERTEXADE_MCP_SERVERS: '[]' })
    expect(resume.args).toEqual(
      expect.arrayContaining(['--prompt', 'ship it', '--resume', 'session-1', '--model', 'sonnet', '--reasoning-effort', 'high']),
    )
    const review = agent.launch({ cwd: '/work', prompt: 'review it', reviewMode: true })
    expect(review.args).toEqual(expect.arrayContaining(['--prompt', 'review it']))
    const fork = agent.launch({
      cwd: '/work',
      prompt: 'continue',
      fork: 'session-1',
      permissionMode: 'full',
    })
    expect(fork.args).toEqual(expect.arrayContaining(['--prompt', 'continue', '--fork', 'session-1']))
  })

  it('forwards read-only generation to the Claude bridge', () => {
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: {} })
    expect(agent.supportsReadOnlyMode).toBe(true)
    expect(agent.launch({ cwd: '/work', prompt: 'generate a title', permissionMode: 'read-only' }).args).toEqual(
      expect.arrayContaining(['--permission-mode', 'read-only']),
    )
  })

  it('forwards ephemeral launches to the Claude bridge', () => {
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: {} })
    expect(agent.supportsEphemeral).toBe(true)
    expect(agent.launch({ cwd: '/work', prompt: 'review it', ephemeral: true }).args).toContain('--ephemeral')
  })

  it('forwards permission for Claude native sub-agents', () => {
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: {} })
    expect(agent.subagentOrchestration).toBe('native')
    expect(agent.launch({ cwd: '/work', prompt: 'ship it', allowSubagents: true }).args).toContain('--allow-subagents')
  })

  it('normalizes Claude stream-json events into the host event contract', () => {
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: {} })
    expect(
      agent.normalizeEvent?.({
        type: 'system',
        subtype: 'init',
        session_id: 'session-1',
        model: 'claude-sonnet',
        effort: 'high',
      }),
    ).toEqual({
      event: 'thread_started',
      thread_id: 'session-1',
      model: 'claude-sonnet',
      reasoning_effort: 'high',
      time: null,
    })
    expect(
      agent.normalizeEvent?.({
        type: 'assistant',
        session_id: 'session-1',
        message: { content: [{ type: 'text', text: 'Done' }] },
      }),
    ).toEqual({
      event: 'agent_message',
      thread_id: 'session-1',
      text: 'Done',
      time: null,
    })
    expect(
      agent.normalizeEvent?.({
        type: 'assistant',
        session_id: 'session-1',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] },
      }),
    ).toEqual({
      event: 'action_started',
      thread_id: 'session-1',
      time: null,
      action: expect.objectContaining({ title: 'npm test', kind: 'Bash', status: 'running' }),
    })
    expect(
      agent.normalizeEvent?.({
        type: 'user',
        session_id: 'session-1',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'Passed' }] },
      }),
    ).toEqual({
      event: 'action_completed',
      thread_id: 'session-1',
      time: null,
      action: expect.objectContaining({ id: 'tool-1', status: 'completed', output: 'Passed' }),
    })
    expect(
      agent.normalizeEvent?.({
        type: 'result',
        subtype: 'success',
        session_id: 'session-1',
        result: 'Complete',
        is_error: false,
      }),
    ).toEqual({
      event: 'agent_message',
      thread_id: 'session-1',
      text: 'Complete',
      time: null,
    })
    expect(
      agent.normalizeEvent?.({
        type: 'result',
        subtype: 'error_max_turns',
        session_id: 'session-1',
        result: 'Stopped',
        is_error: true,
      }),
    ).toEqual({
      event: 'error',
      thread_id: 'session-1',
      message: 'Stopped',
      retryable: null,
      statusCode: null,
      time: null,
    })
  })

  it('offers Claude model aliases and effort levels', async () => {
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: {} })
    const options = (await agent.launchOptions?.()) as {
      models: { id: string; reasoning_efforts: { id: string }[] }[]
    }
    expect(options.models.map(({ id }) => id)).toEqual(['sonnet', 'opus', 'fable'])
    expect(options.models[0].reasoning_efforts.map(({ id }) => id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('prefers detailed model metadata and exposes each model reasoning level', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          'custom-sonnet': {
            display_name: 'Custom Sonnet',
            capabilities: {
              reasoning: { supported: true, levels: ['none', 'low', 'high'], default_level: 'low' },
            },
          },
          'custom-opus': {
            name: 'Custom Opus',
            description: 'Gateway model',
            capabilities: { reasoning: { supported: true, levels: [], default_level: null } },
          },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: {} })

    const options = (await agent.launchOptions?.({
      environment: {
        ANTHROPIC_BASE_URL: 'https://gateway.example.test/anthropic/v1',
        ANTHROPIC_AUTH_TOKEN: 'secret-token',
      },
    })) as {
      models: {
        id: string
        name: string
        description: string
        default_reasoning_effort: string
        reasoning_efforts: { id: string }[]
      }[]
    }

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://gateway.example.test/anthropic/v1/models/info'),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer secret-token',
          'anthropic-version': '2023-06-01',
        }),
      }),
    )
    expect(options.models).toEqual([
      expect.objectContaining({
        id: 'custom-sonnet',
        name: 'Custom Sonnet',
        default_reasoning_effort: 'low',
        reasoning_efforts: [
          { id: 'none', description: '' },
          { id: 'low', description: '' },
          { id: 'high', description: '' },
        ],
      }),
      expect.objectContaining({
        id: 'custom-opus',
        name: 'Custom Opus',
        description: 'Gateway model',
        default_reasoning_effort: '',
        reasoning_efforts: [],
      }),
    ])
    vi.unstubAllGlobals()
  })

  it('falls back to the standard models endpoint when detailed metadata is unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'fallback-model', display_name: 'Fallback model' }] })))
    vi.stubGlobal('fetch', fetchMock)
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: {} })

    const options = (await agent.launchOptions?.({
      environment: { ANTHROPIC_BASE_URL: 'https://gateway.example.test/v1' },
    })) as { models: { id: string; reasoning_efforts: { id: string }[] }[] }

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://gateway.example.test/v1/models/info',
      'https://gateway.example.test/v1/models',
    ])
    expect(options.models[0]).toMatchObject({
      id: 'fallback-model',
      default_reasoning_effort: 'medium',
    })
    expect(options.models[0].reasoning_efforts.map(({ id }) => id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    vi.unstubAllGlobals()
  })

  it('passes selected discovered models to Claude Code', () => {
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: {} })
    const args = agent.launch({ prompt: 'ship it', model: 'custom-sonnet' }).args
    const modelFlag = args.indexOf('--model')
    expect(args.slice(modelFlag, modelFlag + 2)).toEqual(['--model', 'custom-sonnet'])
  })

  it('rejects an invalid configured model endpoint without exposing its value', async () => {
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: {} })
    await expect(agent.launchOptions?.({ environment: { ANTHROPIC_BASE_URL: 'not-a-url' } })).rejects.toThrow(
      'ANTHROPIC_BASE_URL to be an absolute HTTP(S) URL',
    )
  })

  it('detects durable Claude sessions', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-code-home-'))
    const sessions = join(home, '.claude', 'projects', 'workspace')
    await mkdir(sessions, { recursive: true })
    await writeFile(join(sessions, 'session-1.jsonl'), '{}\n')
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: { HOME: home } })
    await expect(agent.resumableThreadExists?.('session-1')).resolves.toBe(true)
    await expect(agent.resumableThreadExists?.('missing')).resolves.toBe(false)
    await rm(home, { recursive: true })
  })

  it('deletes only the requested durable Claude session', async () => {
    const home = await mkdtemp(join(tmpdir(), 'claude-code-home-'))
    const sessions = join(home, '.claude', 'projects', 'workspace')
    await mkdir(sessions, { recursive: true })
    await writeFile(join(sessions, 'session-1.jsonl'), '{}\n')
    await writeFile(join(sessions, 'session-2.jsonl'), '{}\n')
    const agent = createClaudeCodeAgent({ run: vi.fn(), env: { HOME: home } })

    await agent.deleteThread?.('session-1')

    await expect(agent.resumableThreadExists?.('session-1')).resolves.toBe(false)
    await expect(agent.resumableThreadExists?.('session-2')).resolves.toBe(true)
    await rm(home, { recursive: true })
  })
})

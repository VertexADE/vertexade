import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase, type DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { AgentRegistry } from './registry.ts'
import { SubagentHarness } from './subagent-harness.ts'

let directory = ''
let database: DrizzleDashboardDatabase

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vertexade-subagents-'))
  database = openDashboardDatabase(join(directory, 'dashboard.sqlite'))
  database.$client
    .prepare(`INSERT INTO repositories (id,full_name,clone_url,local_path)
    VALUES (1,'owner/repo','ssh://repo','/repo')`)
    .run()
  database.$client.prepare(`INSERT INTO work_items (id,key,title) VALUES (7,'W-0007','Parent Work')`).run()
  database.$client
    .prepare(`INSERT INTO jobs
    (id,repo_id,pr_number,prompt,worktree_path,session_cwd,log_path,status,base_repo_path,head_sha,
     latest_activity,kind,task_title,agent_id,work_item_id,workspace_mode)
    VALUES (10,1,0,'parent','/parent','/parent','/parent.log','running','/repo','abc',
      'Working','pre_pr','Parent','codex',7,'combined')`)
    .run()
})

afterEach(async () => {
  database.close()
  await rm(directory, { recursive: true, force: true })
})

function fixture() {
  const agents = new AgentRegistry()
  agents.register('codex', {
    id: 'codex',
    name: 'Codex',
    enabled: true,
    workspaceRoot: '/agents',
    launch: () => ({ command: 'codex', args: [] }),
    launchOptions: async () => ({
      models: [
        {
          id: 'gpt-test',
          name: 'GPT test',
          reasoning_efforts: [{ id: 'high', description: 'High' }],
        },
      ],
    }),
  })
  const startChild = vi.fn()
  const integrateWorkspace = vi.fn(async () => ({ applied: true, files: ['src/cache.ts'] }))
  const harness = new SubagentHarness({
    database,
    agents,
    activeJobs: new Map(),
    cancellingJobs: new Set(),
    logsRoot: directory,
    apiUrl: 'http://127.0.0.1:4174',
    notify: vi.fn(),
    resolveLaunch: async (_workItemId, prompt) => ({ prompt }),
    createWorkspace: async () => ({
      worktree: '/child',
      sessionCwd: '/work-item-run',
      baseGitDir: '/repo/.git',
      baselineSha: 'baseline',
      branchName: 'subagent/10-cache',
    }),
    discardWorkspace: vi.fn(async () => undefined),
    integrateWorkspace,
    startChild,
  })
  const launch = harness.decorateLaunch(10, { allowSubagents: true, mcpServers: [] }) as {
    mcpServers: Array<{ name: string; env: Record<string, string> }>
  }
  const token = launch.mcpServers[0]!.env.VERTEXADE_SUBAGENT_TOKEN
  const request = (path: string, init: RequestInit = {}) =>
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    })
  return { harness, integrateWorkspace, launch, request, startChild }
}

describe('VertexADE sub-agent harness', () => {
  it('injects a scoped built-in MCP server without exposing the token in storage', () => {
    const { launch } = fixture()
    expect(launch.mcpServers[0]).toMatchObject({
      name: 'vertexade-subagents',
      env: {
        VERTEXADE_SUBAGENT_API_URL: 'http://127.0.0.1:4174',
        VERTEXADE_SUBAGENT_TOKEN: expect.stringMatching(/^10\./),
      },
    })
    const stored = database.$client.prepare('SELECT allow_subagents,subagent_token_hash FROM jobs WHERE id=10').get()
    expect(stored).toMatchObject({
      allow_subagents: 1,
      subagent_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(stored.subagent_token_hash).not.toBe(launch.mcpServers[0]!.env.VERTEXADE_SUBAGENT_TOKEN)
  })

  it('discovers models and launches a non-recursive writable child in its own worktree', async () => {
    const { harness, request, startChild } = fixture()
    const agents = await harness.dispatch(request('/api/internal/subagents/agents'))
    expect(await agents?.json()).toMatchObject({
      parent_run_id: 10,
      agents: [{ id: 'codex', models: [{ id: 'gpt-test' }] }],
    })

    const response = await harness.dispatch(
      request('/api/internal/subagents/runs', {
        method: 'POST',
        body: JSON.stringify({
          task: 'Improve the cache',
          title: 'Cache improvements',
          agent_id: 'codex',
          model: 'gpt-test',
          reasoning_effort: 'high',
        }),
      }),
    )
    expect(response?.status).toBe(202)
    const child = await response?.json()
    expect(child).toMatchObject({
      parent_run_id: 10,
      status: 'starting',
      agent_id: 'codex',
      model: 'gpt-test',
      branch: 'subagent/10-cache',
      workspace: '/child',
    })
    expect(startChild).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: child.run_id,
        launch: expect.objectContaining({
          cwd: '/work-item-run',
          reviewMode: false,
          allowSubagents: false,
        }),
      }),
    )
    expect(startChild.mock.calls[0]![0].launch).not.toHaveProperty('permissionMode')
  })

  it('integrates only a completed child owned by the requesting parent', async () => {
    const { harness, integrateWorkspace, request } = fixture()
    const spawned = await harness.dispatch(
      request('/api/internal/subagents/runs', {
        method: 'POST',
        body: JSON.stringify({ task: 'Implement the cache', model: 'gpt-test' }),
      }),
    )
    const child = await spawned?.json()
    database.$client.prepare("UPDATE jobs SET status='completed',finished_at=CURRENT_TIMESTAMP WHERE id=?").run(child.run_id)

    const integrated = await harness.dispatch(request(`/api/internal/subagents/runs/${child.run_id}/integrate`, { method: 'POST' }))
    expect(await integrated?.json()).toEqual({
      run_id: child.run_id,
      integrated: true,
      already_integrated: false,
      applied: true,
      files: ['src/cache.ts'],
    })
    expect(integrateWorkspace).toHaveBeenCalledOnce()

    const repeated = await harness.dispatch(request(`/api/internal/subagents/runs/${child.run_id}/integrate`, { method: 'POST' }))
    expect(await repeated?.json()).toMatchObject({ integrated: true, already_integrated: true })
    expect(integrateWorkspace).toHaveBeenCalledOnce()
  })

  it('rejects invalid capabilities and unavailable models', async () => {
    const { harness, request } = fixture()
    const unauthorized = await harness.dispatch(
      new Request('http://localhost/api/internal/subagents/agents', {
        headers: { authorization: 'Bearer 10.invalid' },
      }),
    )
    expect(unauthorized?.status).toBe(401)

    const invalidModel = await harness.dispatch(
      request('/api/internal/subagents/runs', {
        method: 'POST',
        body: JSON.stringify({ task: 'Try another model', model: 'missing' }),
      }),
    )
    expect(invalidModel?.status).toBe(400)
    expect(await invalidModel?.json()).toEqual({ error: 'Model is not available for Codex' })
  })
})

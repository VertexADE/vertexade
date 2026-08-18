import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase, type DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { resolveFormRequest } from './form-requests.ts'
import { AgentRegistry } from './registry.ts'
import { SubagentHarness } from './subagent-harness.ts'
import { VertexMcpIntegration } from './vertex-mcp-integration.ts'

let directory = ''
let database: DrizzleDashboardDatabase

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vertexade-mcp-integration-'))
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

function fixture(allowSubagents = true) {
  const agents = new AgentRegistry()
  agents.register('codex', {
    id: 'codex',
    name: 'Codex',
    enabled: true,
    workspaceRoot: '/agents',
    launch: () => ({ command: 'codex', args: [] }),
    launchOptions: async () => ({ models: [{ id: 'gpt-test', name: 'GPT test', reasoning_efforts: [] }] }),
  })
  const startChild = vi.fn()
  const activeJobs = new Map<number, { pid?: number; kill(signal?: NodeJS.Signals): boolean }>()
  const integrateWorkspace = vi.fn(async () => ({ applied: true, files: ['src/cache.ts'] }))
  const harness = new SubagentHarness({
    database,
    agents,
    activeJobs,
    cancellingJobs: new Set(),
    logsRoot: directory,
    notify: vi.fn(),
    resolveLaunch: async (_workItemId, prompt) => ({ prompt }),
    createWorkspace: async () => ({
      worktree: '/parent',
      sessionCwd: '/work-item-run',
      baseGitDir: '/repo/.git',
      baselineSha: 'baseline',
      branchName: 'feature/shared-work',
    }),
    discardWorkspace: vi.fn(async () => undefined),
    integrateWorkspace,
    startChild,
  })
  const integration = new VertexMcpIntegration({
    database,
    harness,
    apiUrl: 'http://127.0.0.1:4174',
    notify: vi.fn(),
  })
  const launch = integration.decorateLaunch(10, { allowSubagents, mcpServers: [] }) as {
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
  return { activeJobs, integrateWorkspace, integration, launch, request, startChild }
}

describe('VertexMcpIntegration', () => {
  it('persists a form and returns its submitted Markdown while child delegation is disabled', async () => {
    const { integration, launch, request } = fixture(false)
    expect(launch.mcpServers[0]?.env.VERTEXADE_SUBAGENTS_ENABLED).toBe('0')
    const denied = await integration.dispatch(request('/api/internal/subagents/agents'))
    expect(denied?.status).toBe(401)
    expect(database.$client.prepare('SELECT allow_subagents FROM jobs WHERE id=10').get()).toEqual({ allow_subagents: 0 })

    const response = integration.dispatch(
      request('/api/internal/subagents/form', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Project setup',
          fields: [
            { id: 'name', label: 'Project name', type: 'text' },
            { id: 'due', label: 'Delivery date', type: 'date' },
            { id: 'token', label: 'Access token', type: 'password' },
            {
              id: 'channels',
              label: 'Delivery channels',
              type: 'checkbox',
              options: [{ label: 'Web', value: 'web' }],
            },
          ],
        }),
      }),
    )
    let requestId = ''
    await vi.waitFor(() => {
      const stored = database.$client.prepare('SELECT input_request_id,input_questions FROM jobs WHERE id=10').get() as {
        input_request_id: string
        input_questions: string
      }
      requestId = JSON.parse(stored.input_request_id)
      expect(requestId).toMatch(/^form:/)
      expect(JSON.parse(stored.input_questions)).toMatchObject([
        { id: 'name', type: 'text', formTitle: 'Project setup' },
        { id: 'due', type: 'date' },
        { id: 'token', type: 'password', isSecret: true },
        { id: 'channels', type: 'checkbox', options: [{ label: 'Web', value: 'web' }] },
      ])
    })
    resolveFormRequest(requestId, { status: 'submitted', markdown: '## Project setup\n\n- **Project name:** VertexADE' })

    await expect(response.then((value) => value?.json())).resolves.toEqual({
      status: 'submitted',
      markdown: '## Project setup\n\n- **Project name:** VertexADE',
    })
  })

  it('injects a scoped built-in MCP server without exposing the token in storage', () => {
    const { launch } = fixture()

    expect(launch.mcpServers[0]).toMatchObject({
      name: 'vertexade-subagents',
      defaultEnabled: true,
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

  it('adds the Vertex Form requirement to every agent prompt', () => {
    const { integration } = fixture()
    const launch = integration.decorateLaunch(10, {
      prompt: 'Implement the feature',
      allowSubagents: false,
      mcpServers: [],
    }) as { prompt: string }

    expect(launch.prompt).toContain('Implement the feature')
    expect(launch.prompt).toMatch(/Vertex Form.*MUST use it.*two or more answers/s)
    expect(launch.prompt).toMatch(/select, checkbox, number, date, email, URL, password, or multiline/)
  })

  it('always replaces a conflicting configured VertexADE MCP with the scoped built-in server', () => {
    const { integration } = fixture()
    const launch = integration.decorateLaunch(10, {
      allowSubagents: false,
      mcpServers: [
        {
          id: 'user-defined',
          name: 'vertexade-subagents',
          transport: 'stdio',
          command: 'untrusted-command',
          defaultEnabled: false,
        },
      ],
    }) as { mcpServers: Array<{ id: string; name: string; command: string; defaultEnabled: boolean }> }

    expect(launch.mcpServers.filter((server) => server.name === 'vertexade-subagents')).toHaveLength(1)
    expect(launch.mcpServers[0]).toMatchObject({
      id: 'vertexade:subagents',
      name: 'vertexade-subagents',
      command: process.execPath,
      defaultEnabled: true,
    })
  })

  it('adapts authenticated MCP HTTP requests to the subagent harness', async () => {
    const { integration, request, startChild } = fixture()

    const agents = await integration.dispatch(request('/api/internal/subagents/agents'))
    expect(await agents?.json()).toMatchObject({ parent_run_id: 10, agents: [{ id: 'codex', models: [{ id: 'gpt-test' }] }] })

    const spawned = await integration.dispatch(
      request('/api/internal/subagents/runs', {
        method: 'POST',
        body: JSON.stringify({ task: 'Improve the cache', model: 'gpt-test' }),
      }),
    )
    expect(spawned?.status).toBe(202)
    expect(await spawned?.json()).toMatchObject({ parent_run_id: 10, status: 'starting', agent_id: 'codex', model: 'gpt-test' })
    expect(startChild).toHaveBeenCalledOnce()
  })

  it('adapts cancellation and idempotent integration responses', async () => {
    const { activeJobs, integrateWorkspace, integration, request } = fixture()
    const spawned = await integration.dispatch(
      request('/api/internal/subagents/runs', {
        method: 'POST',
        body: JSON.stringify({ task: 'Lifecycle task', model: 'gpt-test' }),
      }),
    )
    const child = (await spawned?.json()) as { run_id: number }
    const kill = vi.fn(() => true)
    activeJobs.set(child.run_id, { kill })

    const cancelled = await integration.dispatch(request(`/api/internal/subagents/runs/${child.run_id}/cancel`, { method: 'POST' }))
    expect(cancelled?.status).toBe(202)
    expect(await cancelled?.json()).toEqual({ run_id: child.run_id, accepted: true, status: 'cancelling' })
    expect(kill).toHaveBeenCalledWith('SIGTERM')

    database.$client.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(child.run_id)
    const integrated = await integration.dispatch(request(`/api/internal/subagents/runs/${child.run_id}/integrate`, { method: 'POST' }))
    expect(await integrated?.json()).toEqual({
      run_id: child.run_id,
      integrated: true,
      already_integrated: false,
      applied: true,
      files: ['src/cache.ts'],
    })
    const repeated = await integration.dispatch(request(`/api/internal/subagents/runs/${child.run_id}/integrate`, { method: 'POST' }))
    expect(await repeated?.json()).toMatchObject({ integrated: true, already_integrated: true })
    expect(integrateWorkspace).toHaveBeenCalledOnce()
  })

  it('rejects invalid MCP capabilities before invoking the harness', async () => {
    const { integration } = fixture()
    const response = await integration.dispatch(
      new Request('http://localhost/api/internal/subagents/agents', {
        headers: { authorization: 'Bearer 10.invalid' },
      }),
    )

    expect(response?.status).toBe(401)
    expect(await response?.json()).toEqual({ error: 'Invalid sub-agent capability' })
  })

  it('rejects expired capabilities and inactive parents', async () => {
    const { integration, request } = fixture()
    database.$client.prepare("UPDATE jobs SET subagent_token_expires_at='2000-01-01 00:00:00' WHERE id=10").run()

    const expired = await integration.dispatch(request('/api/internal/subagents/agents'))
    expect(expired?.status).toBe(401)
    expect(await expired?.json()).toEqual({ error: 'The sub-agent capability expired' })

    database.$client.prepare("UPDATE jobs SET subagent_token_expires_at=datetime('now','+1 hour'),status='completed' WHERE id=10").run()
    const inactive = await integration.dispatch(request('/api/internal/subagents/agents'))
    expect(inactive?.status).toBe(409)
    expect(await inactive?.json()).toEqual({ error: 'The parent run is no longer active' })
  })

  it('passes unrelated routes through and rejects malformed authenticated requests', async () => {
    const { integration, request } = fixture()

    await expect(integration.dispatch(new Request('http://localhost/api/work'))).resolves.toBeNull()
    const malformed = await integration.dispatch(
      request('/api/internal/subagents/runs', {
        method: 'POST',
        body: '{',
      }),
    )
    expect(malformed?.status).toBe(400)
    expect(await malformed?.json()).toEqual({ error: 'Request body must contain valid JSON' })
  })

  it('allows only one concurrent form request for a parent', async () => {
    const { integration, request } = fixture(false)
    const input = {
      method: 'POST',
      body: JSON.stringify({ title: 'Concurrent form', fields: [{ id: 'answer', label: 'Answer', type: 'text' }] }),
    }
    const first = integration.dispatch(request('/api/internal/subagents/form', input))
    const second = integration.dispatch(request('/api/internal/subagents/form', input))

    const firstCompleted = first.then((response) => ({ response, waiting: second }))
    const secondCompleted = second.then((response) => ({ response, waiting: first }))
    const rejected = await Promise.race([firstCompleted, secondCompleted])
    expect(rejected.response?.status).toBe(409)
    expect(await rejected.response?.json()).toEqual({ error: 'This thread already has a pending input request' })

    const stored = database.$client.prepare('SELECT input_request_id FROM jobs WHERE id=10').get() as { input_request_id: string }
    resolveFormRequest(JSON.parse(stored.input_request_id), { status: 'cancelled', reason: 'Test cleanup' })
    const accepted = await rejected.waiting
    expect(accepted?.status).toBe(200)
    expect(await accepted?.json()).toEqual({ status: 'cancelled', reason: 'Test cleanup' })
  })

  it('clears an inline form when the MCP HTTP request disconnects', async () => {
    const { integration, request } = fixture(false)
    const controller = new AbortController()
    const response = integration.dispatch(
      request('/api/internal/subagents/form', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ title: 'Abort form', fields: [{ id: 'answer', label: 'Answer', type: 'text' }] }),
      }),
    )
    await vi.waitFor(() => {
      expect(database.$client.prepare('SELECT input_request_id FROM jobs WHERE id=10').get()).toMatchObject({
        input_request_id: expect.stringMatching(/^"form:/),
      })
    })

    controller.abort()

    await expect(response.then((value) => value?.json())).resolves.toEqual({
      status: 'cancelled',
      reason: 'The agent stopped waiting for form input',
    })
    expect(database.$client.prepare('SELECT input_request_id,input_questions FROM jobs WHERE id=10').get()).toEqual({
      input_request_id: null,
      input_questions: null,
    })
  })
})

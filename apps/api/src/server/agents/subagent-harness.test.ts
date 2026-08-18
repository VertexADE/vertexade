import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase, type DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs } from '../database/schema/tables.ts'
import { AgentRegistry } from './registry.ts'
import { SubagentHarness, subagentJobRecord } from './subagent-harness.ts'

let directory = ''
let database: DrizzleDashboardDatabase

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vertexade-subagent-harness-'))
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
  const activeJobs = new Map<number, { pid?: number; kill(signal?: NodeJS.Signals): boolean }>()
  const discardWorkspace = vi.fn(async () => undefined)
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
    discardWorkspace,
    integrateWorkspace,
    startChild,
  })
  const storedParent = database.select().from(jobs).where(eq(jobs.id, 10)).get()
  if (!storedParent) throw new Error('Expected seeded parent')
  const parent = subagentJobRecord(storedParent, 'owner/repo')
  return { activeJobs, discardWorkspace, harness, integrateWorkspace, parent, startChild }
}

describe('SubagentHarness', () => {
  it('discovers models and launches one non-recursive child in the shared worktree', async () => {
    const { harness, parent, startChild } = fixture()

    await expect(harness.availableAgents()).resolves.toMatchObject([{ id: 'codex', models: [{ id: 'gpt-test' }] }])
    const child = await harness.spawn(parent, {
      task: 'Improve the cache',
      title: 'Cache improvements',
      agent_id: 'codex',
      model: 'gpt-test',
      reasoning_effort: 'high',
    })

    expect(child).toMatchObject({
      source_job_id: 10,
      status: 'starting',
      agent_id: 'codex',
      agent_model: 'gpt-test',
      branch_name: 'feature/shared-work',
      worktree_path: '/parent',
    })
    expect(startChild).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: child.id,
        launch: expect.objectContaining({
          cwd: '/work-item-run',
          reviewMode: false,
          allowSubagents: false,
        }),
      }),
    )
    expect(startChild.mock.calls[0]![0].launch).not.toHaveProperty('permissionMode')
  })

  it('rejects a second child while the shared worktree already has an active child', async () => {
    const { harness, parent } = fixture()
    await harness.spawn(parent, { task: 'First shared task', model: 'gpt-test' })

    await expect(harness.spawn(parent, { task: 'Second shared task', model: 'gpt-test' })).rejects.toMatchObject({
      message: 'Wait for one of the 1 active child agents to finish',
      status: 409,
    })
  })

  it('cancels an attached active child and records launch failures', async () => {
    const { activeJobs, discardWorkspace, harness, parent, startChild } = fixture()
    const child = await harness.spawn(parent, { task: 'Cancelable task', model: 'gpt-test' })
    const kill = vi.fn(() => true)
    activeJobs.set(child.id, { kill })

    expect(harness.cancel(parent.id, child.id)).toMatchObject({ child: { id: child.id }, accepted: true })
    expect(kill).toHaveBeenCalledWith('SIGTERM')

    database.$client.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(child.id)
    startChild.mockImplementationOnce(() => {
      throw new Error('Agent process failed to launch')
    })
    await expect(harness.spawn(parent, { task: 'Broken launch', model: 'gpt-test' })).rejects.toThrow('Agent process failed to launch')
    const failed = database.$client.prepare("SELECT status,latest_activity FROM jobs WHERE task_title='Broken launch'").get()
    expect(failed).toEqual({ status: 'failed', latest_activity: 'Agent process failed to launch' })
    expect(discardWorkspace).toHaveBeenCalledOnce()
  })

  it('integrates only a completed child owned by the requesting parent', async () => {
    const { harness, integrateWorkspace, parent } = fixture()
    const child = await harness.spawn(parent, { task: 'Implement the cache', model: 'gpt-test' })
    database.$client.prepare("UPDATE jobs SET status='completed',finished_at=CURRENT_TIMESTAMP WHERE id=?").run(child.id)

    const integrated = await harness.integrate(parent, child.id)
    expect(integrated).toMatchObject({ alreadyIntegrated: false, result: { applied: true, files: ['src/cache.ts'] } })
    expect(integrateWorkspace).toHaveBeenCalledOnce()

    const repeated = await harness.integrate(parent, child.id)
    expect(repeated).toMatchObject({ alreadyIntegrated: true, result: { files: [] } })
    expect(integrateWorkspace).toHaveBeenCalledOnce()
  })

  it('keeps legacy child status readable when only its integration baseline is missing', async () => {
    const { harness, parent } = fixture()
    database
      .insert(jobs)
      .values({
        id: 20,
        repoId: 1,
        prNumber: 0,
        prompt: 'legacy child',
        worktreePath: '/parent',
        sessionCwd: '/parent',
        logPath: '/legacy-child.log',
        status: 'completed',
        baseRepoPath: '/repo',
        headSha: 'abc',
        kind: 'subagent',
        sourceJobId: 10,
        taskTitle: 'Legacy child',
        agentId: 'codex',
        workItemId: 7,
        workspaceMode: 'combined',
      })
      .run()

    expect(harness.child(parent.id, 20)).toMatchObject({ id: 20, status: 'completed', subagent_base_sha: null })
    await expect(harness.integrate(parent, 20)).rejects.toMatchObject({
      message: 'Child agent workspace baseline is missing',
      status: 409,
    })
  })

  it('serializes concurrent integration attempts for the same child', async () => {
    const { harness, integrateWorkspace, parent } = fixture()
    const child = await harness.spawn(parent, { task: 'Integrate once', model: 'gpt-test' })
    database.$client.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(child.id)
    let finishIntegration!: (result: { applied: boolean; files: string[] }) => void
    integrateWorkspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishIntegration = resolve
        }),
    )

    const first = harness.integrate(parent, child.id)
    await vi.waitFor(() => expect(integrateWorkspace).toHaveBeenCalledOnce())
    await expect(harness.integrate(parent, child.id)).rejects.toMatchObject({
      message: 'The child agent is already being integrated',
      status: 409,
    })
    finishIntegration({ applied: true, files: ['src/cache.ts'] })
    await expect(first).resolves.toMatchObject({ alreadyIntegrated: false, result: { applied: true } })
  })

  it('rejects unavailable models before creating a child run', async () => {
    const { harness, parent } = fixture()

    await expect(harness.spawn(parent, { task: 'Try another model', model: 'missing' })).rejects.toMatchObject({
      message: 'Model is not available for Codex',
      status: 400,
    })
  })

  it('rejects an unlisted reasoning level instead of passing it to the child provider', async () => {
    const { harness, parent, startChild } = fixture()

    await expect(
      harness.spawn(parent, {
        task: 'Try unsupported reasoning',
        model: 'gpt-test',
        reasoning_effort: 'ultra',
      }),
    ).rejects.toMatchObject({
      message: 'Reasoning effort is not available for gpt-test',
      status: 400,
    })
    expect(startChild).not.toHaveBeenCalled()
  })
})

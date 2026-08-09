import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import { registerCoreAutomationActions } from './core-automation-actions.ts'

const databases: Array<{ close(): void }> = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture(status = 'completed', exitCode: number | null = 0) {
  const database = openDashboardDatabase(':memory:')
  databases.push(database)
  database.$client
    .prepare('INSERT INTO repositories (full_name,clone_url,local_path) VALUES (?,?,?)')
    .run('acme/api', 'git@example.test:acme/api.git', '/repos/api')
  database.$client
    .prepare(
      "INSERT INTO work_items (id,key,title,kind,state,primary_repository_id) VALUES (1,'W-0001','Repair API','implementation','active',1)",
    )
    .run()
  database.$client
    .prepare(`INSERT INTO jobs
    (repo_id,pr_number,prompt,worktree_path,log_path,status,exit_code,kind,task_title,branch_name,head_sha,work_item_id)
    VALUES (1,0,'Fix','/work/api','/tmp/run.log',?,?,'pre_pr','Repair API','fix/repair','base-sha',1)`)
    .run(status, exitCode)
  database.$client.prepare("INSERT INTO automation_recipes (name) VALUES ('Repair')").run()
  const flow = database.$client
    .prepare(`INSERT INTO automation_flow_runs (recipe_id,status,thread_job_id,phase_count)
    VALUES (1,'running',1,2)`)
    .run()
  const run = vi.fn(async (_command: string, args: string[]) => {
    if (args.includes('status')) return ''
    if (args.includes('rev-list')) return '2'
    if (args.includes('symbolic-ref')) return 'origin/main'
    return ''
  })
  const createPullRequest = vi.fn(async () => ({ url: 'https://example.test/pr/42' }))
  const registries = new PlatformCapabilityRegistries()
  registerCoreAutomationActions(database, registries, {
    run,
    scm: () => ({ createPullRequest }) as never,
  })
  return { registries, run, createPullRequest, flowId: Number(flow.lastInsertRowid) }
}

describe('core automation actions', () => {
  it('publishes a clean completed branch as a draft pull request', async () => {
    const { registries, run, createPullRequest, flowId } = fixture()
    const action = registries.actions.require('core.create-draft-pr')

    await expect(
      action.execute({}, { moduleId: 'core', signal: new AbortController().signal, workflowInstanceId: flowId }),
    ).resolves.toMatchObject({ url: 'https://example.test/pr/42', draft: true, base: 'main' })
    expect(run).toHaveBeenCalledWith('git', ['-C', '/work/api', 'push', '--set-upstream', 'origin', 'fix/repair'])
    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: 'acme/api',
        head: 'fix/repair',
        base: 'main',
        draft: true,
      }),
    )
  })

  it('rejects publication before the thread succeeds', async () => {
    const { registries, flowId } = fixture('failed', 1)
    await expect(
      registries.actions
        .require('core.create-draft-pr')
        .execute({}, { moduleId: 'core', signal: new AbortController().signal, workflowInstanceId: flowId }),
    ).rejects.toThrow('must complete successfully')
  })
})

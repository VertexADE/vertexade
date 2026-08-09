import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { openDashboardDatabase } from './database/dashboard-database.ts'
import { operationalHealth } from './operational-health.ts'

const directories: string[] = []
const databases: Array<{ close(): void }> = []
afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('operational health', () => {
  it('reports deployment identity, runtime state, and durable queue pressure', async () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    database.$client
      .prepare(
        "INSERT INTO repositories (id,full_name,clone_url,local_path) VALUES (1,'acme/api','git@example.test:acme/api.git','/tmp/acme')",
      )
      .run()
    database.$client
      .prepare(
        "INSERT INTO work_items (id,key,title,kind,state,primary_repository_id) VALUES (1,'W-0001','Work','implementation','active',1)",
      )
      .run()
    database.$client
      .prepare(`INSERT INTO jobs (id,repo_id,pr_number,prompt,worktree_path,log_path,status,work_item_id)
      VALUES (1,1,0,'Work','/tmp/work','/tmp/log','running',1)`)
      .run()
    database.$client.prepare("INSERT INTO job_follow_up_queue (job_id,prompt) VALUES (1,'Continue')").run()
    database.$client
      .prepare("INSERT INTO pull_requests (repo_id,number,title,url,head_sha) VALUES (1,7,'Repair','https://example.test/7','abc')")
      .run()
    database.$client.prepare("INSERT INTO automatic_review_queue (repo_id,pr_number,head_sha,agent_id) VALUES (1,7,'abc','codex')").run()
    database.$client.prepare(`INSERT INTO automation_recipes (id,name,steps) VALUES (1,'Improve safely','[]')`).run()
    database.$client
      .prepare(`INSERT INTO automation_flow_runs
      (recipe_id,status,improvement_approval_status,updated_at)
      VALUES (1,'running','pending','2000-01-01 00:00:00')`)
      .run()
    database.$client
      .prepare(`INSERT INTO automation_flow_runs
      (recipe_id,status,improvement_approval_status,updated_at)
      VALUES (1,'running','not-required','2000-01-02 00:00:00')`)
      .run()
    database.$client.prepare('UPDATE automation_runtime_control SET paused=1 WHERE id=1').run()
    const directory = await mkdtemp(join(tmpdir(), 'vertexade-health-'))
    directories.push(directory)
    const deploymentPath = join(directory, 'deployment.json')
    await writeFile(deploymentPath, JSON.stringify({ status: 'verified', commitSha: 'abc123' }))

    await expect(
      operationalHealth(database, deploymentPath, {
        pid: 42,
        uptimeSeconds: 120,
        residentMemoryBytes: 64 * 1024 * 1024,
      }),
    ).resolves.toMatchObject({
      deployment: { status: 'verified', commitSha: 'abc123' },
      process: { pid: 42, uptimeSeconds: 120 },
      queues: { queuedFollowUps: 1, queuedReviews: 1 },
      activity: { activeJobs: 1, failedAutomations: 0 },
      automations: {
        paused: true,
        activeRuns: 2,
        pendingApprovals: 1,
        staleRuns: 1,
        oldestActiveAt: '2000-01-01 00:00:00',
      },
    })
  })

  it('treats missing or malformed deployment metadata as unverified', async () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    await expect(operationalHealth(database, '/missing/deployment.json')).resolves.toMatchObject({
      deployment: null,
    })
  })
})

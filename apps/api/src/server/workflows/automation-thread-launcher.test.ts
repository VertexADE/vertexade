import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { WorkService } from '../work/service.ts'
import { createAutomationThreadLauncher } from './automation-thread-launcher.ts'

const databases: Array<{ close(): void }> = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
  const database = openDashboardDatabase(':memory:')
  databases.push(database)
  const work = new WorkService(database)
  work.initialize()
  database.$client
    .prepare('INSERT INTO repositories (full_name,clone_url,local_path) VALUES (?,?,?)')
    .run('acme/api', 'git@example.test:acme/api.git', '/tmp/acme-api')
  const launchWork = vi.fn(async () => ({ id: 1 }))
  const launchPullRequestWork = vi.fn(async () => ({ id: 4 }))
  const resumeWork = vi.fn(async (jobId: number) => ({ id: jobId }))
  const launchPullRequestReview = vi.fn(async () => ({ id: 2 }))
  const launchWorktreeReview = vi.fn(async () => ({ id: 3 }))
  return {
    database,
    work,
    launchWork,
    launchPullRequestWork,
    resumeWork,
    launchPullRequestReview,
    launchWorktreeReview,
    launch: createAutomationThreadLauncher(database, {
      launchWork,
      launchPullRequestWork,
      resumeWork,
      launchPullRequestReview,
      launchWorktreeReview,
    }),
  }
}

describe('automation thread launcher', () => {
  it('starts Work threads against the Work item repository', async () => {
    const { work, launch, launchWork } = fixture()
    const item = work.create({ title: 'Ship API', repositoryId: 1 })

    await launch('work', 'Implement and verify it.', {
      data: { entityType: 'work-item', entityId: item.id },
    })

    expect(launchWork).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ship API',
        workItemId: item.id,
        repository: expect.objectContaining({ full_name: 'acme/api' }),
      }),
      'Implement and verify it.',
      expect.objectContaining({ agentId: null, allowSubagents: false }),
    )
  })

  it('uses the automation name when a trigger provides an undefined title', async () => {
    const { launch, launchWork } = fixture()

    await launch(
      'work',
      'Run maintenance.',
      { data: { entityType: 'repository', entityId: 1, entity: { title: 'undefined' } } },
      { automationName: 'Nightly maintenance' },
    )

    expect(launchWork).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Nightly maintenance' }),
      'Run maintenance.',
      expect.any(Object),
    )
  })

  it('starts repository-free Work in a managed general workspace', async () => {
    const { work, launch, launchWork } = fixture()
    const item = work.create({ title: 'Investigate operations' })

    await launch('work', 'Investigate and report.', {
      data: { entityType: 'work-item', entityId: item.id },
    })

    expect(launchWork).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Investigate operations',
        workItemId: item.id,
        repository: expect.objectContaining({ full_name: 'Workspace/General' }),
      }),
      'Investigate and report.',
      expect.any(Object),
    )
  })

  it('creates one new Work item containing every repository for a unified scheduled launch', async () => {
    const { database, work } = fixture()
    database.$client
      .prepare('INSERT INTO repositories (full_name,clone_url,local_path) VALUES (?,?,?)')
      .run('acme/web', 'git@example.test:acme/web.git', '/tmp/acme-web')
    const launchWork = vi.fn(async (target, _prompt, options) => {
      const item = work.create({ title: target.title })
      for (const repositoryId of options.repositoryIds || []) {
        const repository = database.$client.prepare('SELECT id, full_name FROM repositories WHERE id = ?').get(repositoryId) as {
          id: number
          full_name: string
        }
        work.linkRepository(item.id, repository)
      }
      return { id: 20 }
    })
    const launch = createAutomationThreadLauncher(database, {
      launchWork,
      launchPullRequestWork: vi.fn(async () => ({ id: 21 })),
      resumeWork: vi.fn(async () => ({ id: 22 })),
      launchPullRequestReview: vi.fn(async () => ({ id: 23 })),
      launchWorktreeReview: vi.fn(async () => ({ id: 24 })),
    })

    expect(work.list()).toHaveLength(0)
    await launch('work', 'Update both repositories.', {
      data: {
        entityType: 'repository',
        entityId: 1,
        launch: { repositoryIds: [1, 2], branchType: 'chore' },
      },
    })

    expect(launchWork).toHaveBeenCalledTimes(1)
    expect(work.list()).toHaveLength(1)
    expect(work.list()[0]).toMatchObject({
      title: 'Automated work for acme/api',
      repository_names: ['acme/api', 'acme/web'],
    })
  })

  it('starts Improve flows in a writable Work thread for approval-gated continuation', async () => {
    const { work, launch, launchWork, launchPullRequestReview } = fixture()
    const item = work.create({ title: 'Improve API', repositoryId: 1 })

    await launch('improve', 'Review without editing.', {
      data: { entityType: 'work-item', entityId: item.id },
    })

    expect(launchWork).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Improve API', workItemId: item.id }),
      'Review without editing.',
      expect.objectContaining({ agentId: null, allowSubagents: false }),
    )
    expect(launchPullRequestReview).not.toHaveBeenCalled()
  })

  it('resumes the existing implementation thread when improving a completed agent run', async () => {
    const { database, work, launch, resumeWork, launchWork } = fixture()
    const item = work.create({ title: 'Improve API', repositoryId: 1 })
    database.$client
      .prepare(`INSERT INTO jobs (repo_id,pr_number,prompt,worktree_path,log_path,status,kind,work_item_id,thread_id)
      VALUES (1,0,'Implement','/tmp/worktree','/tmp/run.log','completed','pre_pr',?,'thread-1')`)
      .run(item.id)

    await launch('improve', 'Review without editing.', {
      data: { entityType: 'agent-thread', entityId: 1 },
    })

    expect(resumeWork).toHaveBeenCalledWith(1, 'Review without editing.')
    expect(launchWork).not.toHaveBeenCalled()
  })

  it('uses the pull request head for Improve flows targeting a pull request', async () => {
    const { database, launch, launchPullRequestWork, launchPullRequestReview } = fixture()
    database.$client
      .prepare(`INSERT INTO pull_requests (repo_id,number,title,url,author,base_ref,head_ref,head_sha)
      VALUES (1,42,'Improve API','https://example.test/pr/42','octo','main','feature/api','abc')`)
      .run()

    await launch('improve', 'Review without editing.', {
      data: { entityType: 'pull-request', entityId: 42, entity: { repo_id: 1 } },
    })

    expect(launchPullRequestWork).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'acme/api' }),
      expect.objectContaining({ number: 42 }),
      'Review without editing.',
      expect.any(Object),
    )
    expect(launchPullRequestReview).not.toHaveBeenCalled()
  })

  it('starts Review threads against a completed implementation worktree', async () => {
    const { database, work, launch, launchWorktreeReview } = fixture()
    const item = work.create({ title: 'Ship API', repositoryId: 1 })
    database.$client
      .prepare(`INSERT INTO jobs (repo_id,pr_number,prompt,worktree_path,log_path,status,kind,work_item_id)
      VALUES (1,0,'Ship','/tmp/worktree','/tmp/run.log','completed','pre_pr',?)`)
      .run(item.id)

    await launch('review', 'Focus on correctness.', {
      data: { entityType: 'agent-thread', entityId: 1 },
    })

    expect(launchWorktreeReview).toHaveBeenCalledWith(1, item.id, 'Focus on correctness.', expect.any(Object))
  })

  it('starts Review threads against a pull request event', async () => {
    const { database, launch, launchPullRequestReview } = fixture()
    database.$client
      .prepare(`INSERT INTO pull_requests (repo_id,number,title,url,author,base_ref,head_ref,head_sha)
      VALUES (1,42,'Ship API','https://example.test/pr/42','octo','main','feature/api','abc')`)
      .run()

    await launch('review', 'Review the public API carefully.', {
      data: { entityType: 'pull-request', entityId: 42, entity: { repo_id: 1 } },
    })

    expect(launchPullRequestReview).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'acme/api' }),
      expect.objectContaining({ number: 42 }),
      'Review the public API carefully.',
      expect.any(Object),
    )
  })

  it('skips another automated review when the current pull request head was already reviewed', async () => {
    const { database, work, launch, launchPullRequestReview } = fixture()
    database.$client
      .prepare(`INSERT INTO pull_requests (repo_id,number,title,url,author,base_ref,head_ref,head_sha)
      VALUES (1,42,'Ship API','https://example.test/pr/42','octo','main','feature/api','head-1')`)
      .run()
    const item = work.create({ title: 'Review API', repositoryId: 1, kind: 'pr_review' })
    database.$client
      .prepare(`INSERT INTO jobs (repo_id,pr_number,prompt,worktree_path,log_path,status,kind,head_sha,work_item_id)
      VALUES (1,42,'Review','/tmp/review','/tmp/review.log','completed','review','head-1',?)`)
      .run(item.id)

    await expect(
      launch('review', 'Review again.', {
        data: { entityType: 'pull-request', entityId: 42, entity: { repo_id: 1 } },
      }),
    ).resolves.toEqual({ skippedReason: 'The current pull request head already has a review' })
    expect(launchPullRequestReview).not.toHaveBeenCalled()
  })

  it('requires an explicit update watch before reviewing a later pull request head', async () => {
    const { database, work, launch, launchPullRequestReview } = fixture()
    database.$client
      .prepare(`INSERT INTO pull_requests (repo_id,number,title,url,author,base_ref,head_ref,head_sha)
      VALUES (1,42,'Ship API','https://example.test/pr/42','octo','main','feature/api','head-2')`)
      .run()
    const item = work.create({ title: 'Review API', repositoryId: 1, kind: 'pr_review' })
    database.$client
      .prepare(`INSERT INTO jobs (repo_id,pr_number,prompt,worktree_path,log_path,status,kind,head_sha,work_item_id)
      VALUES (1,42,'Review','/tmp/review','/tmp/review.log','completed','review','head-1',?)`)
      .run(item.id)
    const event = { data: { entityType: 'pull-request', entityId: 42, entity: { repo_id: 1 } } }

    await expect(launch('review', 'Review the update.', event)).resolves.toEqual({
      skippedReason: 'Watch for updates is off for this pull request',
    })
    expect(launchPullRequestReview).not.toHaveBeenCalled()

    database.$client.prepare('UPDATE pull_requests SET auto_review_watch=1 WHERE repo_id=1 AND number=42').run()
    await expect(launch('review', 'Review the update.', event)).resolves.toEqual({ jobId: 2 })
    expect(launchPullRequestReview).toHaveBeenCalledOnce()
  })
})

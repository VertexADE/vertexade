import { access, mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vite-plus/test'
import { drizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { ensureWorkSchema } from '../database/work-schema.ts'
import { createWorkCleanup } from './cleanup.ts'
import { ensureCleanupSchema } from './cleanup-tombstones.ts'
import { WorkService } from './service.ts'

function setup(
  options: {
    activeJobs?: Map<number, any>
    stopProcess?: (job: any, child: any) => Promise<void>
    run?: (command: string, args: string[]) => Promise<string>
    removeDirectory?: (path: string) => Promise<void>
    pathExists?: (path: string) => Promise<boolean>
    memory?: { exists(workItemId: number): boolean; remove(workItemId: number): Promise<boolean> }
    makeDirectory?: (path: string) => Promise<void>
    removeEmptyDirectory?: (path: string) => Promise<void>
    deleteThread?: (threadId: string) => Promise<void>
    invalidateLog?: (path: string) => void
    removeFile?: (path: string) => Promise<void>
    logsRoot?: string
    legacyLogsRoots?: string[]
    workItemWorkspaceRoot?: string
  } = {},
) {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE repositories (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, local_path TEXT NOT NULL);
    CREATE TABLE pull_requests (id INTEGER PRIMARY KEY, repo_id INTEGER, number INTEGER, title TEXT, url TEXT, draft INTEGER, review_decision TEXT, head_sha TEXT);
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY, repo_id INTEGER NOT NULL, pr_number INTEGER DEFAULT 0, prompt TEXT, worktree_path TEXT, log_path TEXT,
      status TEXT, pid INTEGER, thread_id TEXT, base_repo_path TEXT, source_job_id INTEGER REFERENCES jobs(id), work_item_id INTEGER,
      kind TEXT, agent_id TEXT, task_title TEXT, branch_name TEXT, latest_activity TEXT, activity_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT, input_questions TEXT, linked_pr_number INTEGER, head_sha TEXT,
      session_cwd TEXT, workspace_mode TEXT NOT NULL DEFAULT 'repository', ephemeral INTEGER NOT NULL DEFAULT 0,
      worktree_removed_at TEXT, pr_closed_at TEXT, pr_merged_at TEXT,
      diff_files TEXT, diff_additions INTEGER DEFAULT 0, diff_deletions INTEGER DEFAULT 0
    );
    INSERT INTO repositories (id,full_name,local_path) VALUES (1,'example/repo','/repos/example-repo');
    INSERT INTO pull_requests (id,repo_id,number,title,url,draft,head_sha)
      VALUES (1,1,42,'Preserved PR','https://github.com/example/repo/pull/42',0,'abc');
  `)
  ensureWorkSchema(db)
  ensureCleanupSchema(db)
  const drizzleDb = drizzleDashboardDatabase(db)
  const work = new WorkService(drizzleDb)
  work.initialize()
  const deleteThread = vi.fn(options.deleteThread || (async () => undefined))
  const run = vi.fn(options.run || (async () => ''))
  const removeFile = vi.fn(options.removeFile || (async () => undefined))
  const removeDirectory = vi.fn(options.removeDirectory || (async () => undefined))
  const cleanup = createWorkCleanup({
    db: drizzleDb,
    work,
    memory: options.memory,
    agents: { require: () => ({ name: 'Codex', workspaceRoot: '/managed', deleteThread }) },
    defaultAgentId: 'codex',
    activeJobs: options.activeJobs || new Map(),
    logsRoot: options.logsRoot || '/logs',
    workItemWorkspaceRoot: options.workItemWorkspaceRoot,
    legacyLogsRoots: options.legacyLogsRoots,
    run,
    removeFile,
    invalidateLog: options.invalidateLog,
    removeDirectory,
    pathExists: options.pathExists || (async () => true),
    stopProcess: options.stopProcess,
    makeDirectory: options.makeDirectory,
    removeEmptyDirectory: options.removeEmptyDirectory,
  })
  return { db, work, cleanup, deleteThread, run, removeFile, removeDirectory }
}

function insertJob(db: DatabaseSync, workItemId: number, id: number, overrides: Record<string, unknown> = {}) {
  const value = {
    worktree_path: '/managed/work-1/repo',
    log_path: `/logs/${id}.log`,
    status: 'completed',
    thread_id: `thread-${id}`,
    base_repo_path: '/repos/example-repo',
    branch_name: 'feature/example',
    session_cwd: null,
    workspace_mode: 'repository',
    ...overrides,
  }
  db.prepare(`INSERT INTO jobs (id,repo_id,work_item_id,worktree_path,log_path,status,thread_id,base_repo_path,branch_name,kind,agent_id,session_cwd,workspace_mode)
    VALUES (?,?,?,?,?,?,?,?,?,'pre_pr','codex',?,?)`).run(
    id,
    1,
    workItemId,
    value.worktree_path,
    value.log_path,
    value.status,
    value.thread_id,
    value.base_repo_path,
    value.branch_name,
    value.session_cwd,
    value.workspace_mode,
  )
}

describe('Work cleanup', () => {
  it('removes exclusively owned local execution state and preserves the pull request', async () => {
    const { db, work, cleanup, deleteThread, run, removeFile } = setup()
    const item = work.create({ title: 'Delete me', repositoryId: 1 })!
    work.ensurePullRequestDelivery(
      item.id,
      { id: 1, full_name: 'example/repo' },
      {
        number: 42,
        title: 'Preserved PR',
        url: 'https://github.com/example/repo/pull/42',
        head_sha: 'abc',
      },
    )
    insertJob(db, item.id, 10)

    const preview = cleanup.preview(item.id)!
    expect(preview).toMatchObject({
      threads: { total: 1, active: 0 },
      preserves: { pull_requests: true, remote_branches: true },
    })
    expect(preview.preserved_pull_requests[0].label).toContain('PR #42')
    const result = await cleanup.remove(item.id)

    expect(result).toMatchObject({
      deleted: true,
      threads_deleted: 1,
      worktrees_removed: 1,
      local_branches_deleted: 1,
      logs_deleted: 1,
    })
    expect(deleteThread).toHaveBeenCalledWith('thread-10')
    expect(removeFile).toHaveBeenCalledWith('/logs/10.log')
    expect(run.mock.calls).toContainEqual(['git', ['-C', '/repos/example-repo', 'worktree', 'remove', '--force', '/managed/work-1/repo']])
    expect(run.mock.calls).toContainEqual(['git', ['-C', '/repos/example-repo', 'branch', '-D', '--', 'feature/example']])
    expect(run.mock.calls.flat().join(' ')).not.toContain('push')
    expect(work.raw(item.id)).toBeNull()
    expect(db.prepare('SELECT url FROM pull_requests WHERE id=1').get()).toEqual({
      url: 'https://github.com/example/repo/pull/42',
    })
  })

  it('invalidates transcript cache state when removing a job log', async () => {
    const invalidateLog = vi.fn()
    const { db, work, cleanup } = setup({ invalidateLog })
    const item = work.create({ title: 'Delete cached log', repositoryId: 1 })!
    insertJob(db, item.id, 10)

    await cleanup.remove(item.id)

    expect(invalidateLog).toHaveBeenCalledWith('/logs/10.log')
  })

  it('removes the combined Work folder after its managed repository worktrees', async () => {
    const workItemWorkspaceRoot = '/home/example/.vertex-ade/work-items'
    const { db, work, cleanup, removeDirectory } = setup({ workItemWorkspaceRoot })
    const item = work.create({ title: 'Combined workspace' })!
    insertJob(db, item.id, 10, {
      worktree_path: `${workItemWorkspaceRoot}/${item.key}/example--repo-a`,
      session_cwd: `${workItemWorkspaceRoot}/${item.key}`,
      workspace_mode: 'combined',
    })
    insertJob(db, item.id, 11, {
      worktree_path: `${workItemWorkspaceRoot}/${item.key}/example--repo-b`,
      session_cwd: `${workItemWorkspaceRoot}/${item.key}`,
      workspace_mode: 'combined',
      branch_name: 'feature/example-two',
    })

    const result = await cleanup.remove(item.id)

    expect(result).toMatchObject({ deleted: true, worktrees_removed: 2 })
    expect(removeDirectory).toHaveBeenCalledTimes(1)
    expect(removeDirectory).toHaveBeenCalledWith(`${workItemWorkspaceRoot}/${item.key}`)
  })

  it('refuses to remove a combined Work folder that does not contain its recorded worktree', async () => {
    const { db, work, cleanup, removeDirectory } = setup()
    const item = work.create({ title: 'Unsafe combined workspace' })!
    insertJob(db, item.id, 10, {
      worktree_path: '/managed/other/repo',
      session_cwd: `/managed/work-items/${item.key}`,
      workspace_mode: 'combined',
    })

    const result = await cleanup.remove(item.id)

    expect(result.deleted).toBe(false)
    expect(result.errors).toContainEqual({
      target: `/managed/work-items/${item.key}`,
      error: 'Refusing to remove a combined workspace that does not contain its recorded worktree',
    })
    expect(removeDirectory).not.toHaveBeenCalled()
  })

  it('removes shared Work memory only when permanent deletion can finish', async () => {
    const memory = { exists: vi.fn(() => true), remove: vi.fn(async () => true) }
    const { work, cleanup } = setup({ memory })
    const item = work.create({ title: 'Delete memory' })!
    expect(cleanup.preview(item.id)?.memory_file).toBe(true)

    const result = await cleanup.remove(item.id)

    expect(result).toMatchObject({ deleted: true, memory_deleted: true })
    expect(memory.remove).toHaveBeenCalledWith(item.id)
  })

  it('retains worktrees and local branches still referenced by another Work item', async () => {
    const { db, work, cleanup, run } = setup()
    const first = work.create({ title: 'First' })!
    const second = work.create({ title: 'Second' })!
    insertJob(db, first.id, 10)
    insertJob(db, second.id, 11)

    const result = await cleanup.remove(first.id)

    expect(result).toMatchObject({
      deleted: true,
      shared_worktrees_retained: 1,
      shared_branches_retained: 1,
      worktrees_removed: 0,
      local_branches_deleted: 0,
    })
    expect(run).not.toHaveBeenCalledWith('git', expect.arrayContaining(['remove']))
    expect(db.prepare('SELECT id FROM jobs WHERE id=11').get()).toEqual({ id: 11 })
    expect(work.raw(second.id)).not.toBeNull()
  })

  it('deletes Work when its recorded worktree is already absent', async () => {
    const worktreePath = '/managed/work-1/repo'
    const run = async (_command: string, args: string[]) => {
      if (args.includes('remove')) throw new Error(`fatal: '${worktreePath}' is not a working tree`)
      return ''
    }
    const { db, work, cleanup, removeDirectory } = setup({
      run,
      pathExists: async (path) => path !== worktreePath,
    })
    const item = work.create({ title: 'Already cleaned' })!
    insertJob(db, item.id, 10)

    const result = await cleanup.remove(item.id)

    expect(result).toMatchObject({ deleted: true, threads_deleted: 1, worktrees_removed: 0 })
    expect(removeDirectory).not.toHaveBeenCalled()
    expect(work.raw(item.id)).toBeNull()
  })

  it('ignores an already missing legacy log outside the current logs directory', async () => {
    const legacyLog = '/legacy-dashboard/logs/10.log'
    const { db, work, cleanup, removeFile } = setup({
      pathExists: async (path) => path !== legacyLog,
    })
    const item = work.create({ title: 'Legacy log already removed' })!
    insertJob(db, item.id, 10, { log_path: legacyLog })

    const result = await cleanup.remove(item.id)

    expect(result).toMatchObject({ deleted: true, logs_deleted: 0, threads_deleted: 1 })
    expect(removeFile).not.toHaveBeenCalled()
    expect(work.raw(item.id)).toBeNull()
  })

  it('keeps an existing historical log and its Work ownership until explicit remediation', async () => {
    const legacyLog = '/legacy-dashboard/logs/10.log'
    const { db, work, cleanup, removeFile } = setup()
    const item = work.create({ title: 'Unexpected external log' })!
    insertJob(db, item.id, 10, { log_path: legacyLog })

    const result = await cleanup.remove(item.id)

    expect(result).toMatchObject({
      deleted: false,
      cleanup_complete: false,
      cleanup_pending: 2,
      logs_deleted: 0,
      logs_retained: 1,
      threads_deleted: 0,
    })
    expect(removeFile).not.toHaveBeenCalled()
    expect(work.raw(item.id)).not.toBeNull()
    expect(db.prepare('SELECT kind,state,target FROM work_cleanup_artifacts').get()).toEqual({
      kind: 'log',
      state: 'blocked',
      target: legacyLog,
    })
  })

  it('deletes Work only after the user explicitly detaches a blocked external log', async () => {
    const legacyLog = '/unmanaged-dashboard/logs/10.log'
    const { db, work, cleanup, removeFile } = setup()
    const item = work.create({ title: 'Detach unmanaged log' })!
    insertJob(db, item.id, 10, { log_path: legacyLog })

    const blocked = await cleanup.remove(item.id)
    const artifact = blocked.cleanup_artifacts?.find((entry) => entry.kind === 'log')
    expect(artifact).toMatchObject({ state: 'blocked', target: legacyLog })
    expect(cleanup.detachArtifact(artifact!.id, 'wrong-key')).toBeNull()
    expect(cleanup.detachArtifact(artifact!.id, item.key)).toMatchObject({ state: 'detached' })

    const completed = await cleanup.remove(item.id)
    expect(completed).toMatchObject({
      deleted: true,
      cleanup_complete: true,
      logs_retained: 1,
      provider_threads_retained: 0,
      threads_deleted: 1,
    })
    expect(removeFile).not.toHaveBeenCalledWith(legacyLog)
    expect(work.raw(item.id)).toBeNull()
  })

  it('copies a valid allowlisted legacy log into the canonical root before deleting it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vertexade-legacy-log-'))
    try {
      const logsRoot = join(directory, 'current', 'logs')
      const legacyRoot = join(directory, 'previous', 'logs')
      const legacyLog = join(legacyRoot, 'W-0001--repo--task.log')
      await Promise.all([mkdir(logsRoot, { recursive: true }), mkdir(legacyRoot, { recursive: true })])
      await writeFile(legacyLog, 'legacy transcript')
      const { db, work, cleanup } = setup({
        logsRoot,
        legacyLogsRoots: [legacyRoot],
        removeFile: unlink,
        pathExists: async (path) =>
          access(path)
            .then(() => true)
            .catch(() => false),
      })
      const item = work.create({ title: 'Migrated legacy log' })!
      insertJob(db, item.id, 10, { log_path: legacyLog })

      const result = await cleanup.remove(item.id)

      expect(result).toMatchObject({ deleted: true, cleanup_complete: true, logs_deleted: 1 })
      await expect(access(legacyLog)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(db.prepare("SELECT target,state FROM work_cleanup_artifacts WHERE kind='log'").get()).toMatchObject({
        target: expect.stringContaining('/current/logs/legacy/run-10--W-0001--repo--task.log'),
        state: 'complete',
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('recovers when the process stops after durably retargeting a copied legacy log', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vertexade-legacy-log-retry-'))
    try {
      const logsRoot = join(directory, 'current', 'logs')
      const legacyRoot = join(directory, 'previous', 'logs')
      const legacyLog = join(legacyRoot, 'W-0002--repo--task.log')
      await Promise.all([mkdir(logsRoot, { recursive: true }), mkdir(legacyRoot, { recursive: true })])
      await writeFile(legacyLog, 'retry transcript')
      let sourceFailure = true
      const { db, work, cleanup } = setup({
        logsRoot,
        legacyLogsRoots: [legacyRoot],
        removeFile: async (path) => {
          if (path.endsWith('/previous/logs/W-0002--repo--task.log') && sourceFailure) {
            sourceFailure = false
            throw new Error('simulated interruption')
          }
          await unlink(path)
        },
        pathExists: async (path) =>
          access(path)
            .then(() => true)
            .catch(() => false),
      })
      const item = work.create({ title: 'Resume legacy cleanup' })!
      insertJob(db, item.id, 10, { log_path: legacyLog })

      const interrupted = await cleanup.remove(item.id)
      expect(interrupted).toMatchObject({ deleted: false, cleanup_complete: false })
      expect(db.prepare('SELECT log_path FROM jobs WHERE id=10').get()).toMatchObject({
        log_path: expect.stringContaining('/current/logs/legacy/run-10--W-0002--repo--task.log'),
      })
      expect(db.prepare("SELECT state FROM work_cleanup_artifacts WHERE identity='job:10:legacy-source'").get()).toEqual({
        state: 'retrying',
      })
      db.prepare("UPDATE work_cleanup_artifacts SET next_retry_at=CURRENT_TIMESTAMP WHERE identity='job:10:legacy-source'").run()
      db.prepare('UPDATE work_cleanup_tombstones SET next_retry_at=CURRENT_TIMESTAMP WHERE work_item_id=?').run(item.id)

      const recovered = await cleanup.remove(item.id)
      expect(recovered.cleanup_artifacts).toEqual([])
      expect(recovered).toMatchObject({ deleted: true, cleanup_complete: true })
      await expect(access(legacyLog)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(work.raw(item.id)).toBeNull()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps unavailable provider session ownership and schedules a durable retry', async () => {
    const { db, work, cleanup } = setup({
      deleteThread: async () => {
        throw new Error('Error: failed to delete session')
      },
    })
    const item = work.create({ title: 'Unavailable provider session' })!
    insertJob(db, item.id, 10)

    const result = await cleanup.remove(item.id)

    expect(result).toMatchObject({
      deleted: false,
      cleanup_complete: false,
      cleanup_pending: 1,
      provider_threads_retained: 1,
      threads_deleted: 0,
    })
    expect(result.errors[0]?.error).toContain('will be retried')
    expect(work.raw(item.id)).not.toBeNull()
    expect(db.prepare("SELECT kind,state,next_retry_at FROM work_cleanup_artifacts WHERE kind='provider_thread'").get()).toMatchObject({
      kind: 'provider_thread',
      state: 'retrying',
    })
  })

  it('converges a provider cleanup retry without losing its original job identity', async () => {
    let available = false
    const { db, work, cleanup, deleteThread } = setup({
      deleteThread: async () => {
        if (!available) throw new Error('Provider unavailable')
      },
    })
    const item = work.create({ title: 'Retry provider cleanup' })!
    insertJob(db, item.id, 10)

    const first = await cleanup.remove(item.id)
    expect(first).toMatchObject({ deleted: false, cleanup_pending: 1, threads_deleted: 0 })
    expect(db.prepare('SELECT id FROM jobs WHERE id=10').get()).toEqual({ id: 10 })

    available = true
    const retried = await cleanup.remove(item.id)
    expect(retried).toMatchObject({ deleted: true, cleanup_complete: true, cleanup_pending: 0, threads_deleted: 1 })
    expect(deleteThread).toHaveBeenCalledTimes(2)
    expect(work.raw(item.id)).toBeNull()
  })

  it('removes a safe leftover directory when Git no longer recognizes the worktree', async () => {
    const worktreePath = '/managed/work-1/repo'
    const run = async (_command: string, args: string[]) => {
      if (args.includes('remove')) throw new Error(`fatal: '${worktreePath}' is not a working tree`)
      return ''
    }
    const { db, work, cleanup, removeDirectory } = setup({ run })
    const item = work.create({ title: 'Stale checkout' })!
    insertJob(db, item.id, 10)

    const result = await cleanup.remove(item.id)

    expect(result).toMatchObject({ deleted: true, threads_deleted: 1, worktrees_removed: 1 })
    expect(removeDirectory).toHaveBeenCalledWith(worktreePath)
    expect(work.raw(item.id)).toBeNull()
  })

  it('removes a safe leftover directory when its base repository is already absent', async () => {
    const worktreePath = '/managed/work-1/repo'
    const { db, work, cleanup, removeDirectory, run } = setup({
      pathExists: async (path) => path !== '/repos/example-repo',
    })
    const item = work.create({ title: 'Missing base clone' })!
    insertJob(db, item.id, 10)

    const result = await cleanup.remove(item.id)

    expect(result).toMatchObject({ deleted: true, threads_deleted: 1, worktrees_removed: 1 })
    expect(removeDirectory).toHaveBeenCalledWith(worktreePath)
    expect(run).not.toHaveBeenCalledWith('git', expect.arrayContaining(['worktree', 'remove']))
  })

  it('keeps Work visible when an existing worktree fails for an unexpected reason', async () => {
    const run = async (_command: string, args: string[]) => {
      if (args.includes('remove')) throw new Error('fatal: permission denied')
      return ''
    }
    const { db, work, cleanup, removeDirectory } = setup({ run })
    const item = work.create({ title: 'Unsafe failure' })!
    insertJob(db, item.id, 10)

    const result = await cleanup.remove(item.id)

    expect(result.deleted).toBe(false)
    expect(result.errors[0]).toMatchObject({
      target: '/managed/work-1/repo',
      error: 'fatal: permission denied',
    })
    expect(removeDirectory).not.toHaveBeenCalled()
    expect(work.raw(item.id)).not.toBeNull()
  })

  it('repairs root-owned scanner artifacts before retrying worktree removal', async () => {
    let removals = 0
    const run = async (command: string, args: string[]) => {
      if (command === 'git' && args.includes('remove') && removals++ === 0) {
        throw new Error("EACCES: permission denied, rmdir '/managed/work-1/repo/.trivycache/db'")
      }
      return ''
    }
    const { db, work, cleanup, run: runMock } = setup({ run })
    const item = work.create({ title: 'Root-owned Trivy cache' })!
    insertJob(db, item.id, 10)

    const result = await cleanup.remove(item.id)

    expect(result).toMatchObject({ deleted: true, worktrees_removed: 1 })
    expect(removals).toBe(2)
    expect(runMock).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining([
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--volume',
        '/managed/work-1/repo:/worktree',
        'alpine:3.20',
        'chown',
        '-R',
        expect.stringMatching(/^\d+:\d+$/),
        '/worktree',
      ]),
    )
  })

  it('keeps the Work item visible when an active process cannot be safely stopped', async () => {
    const { db, work, cleanup } = setup()
    const item = work.create({ title: 'Still active' })!
    insertJob(db, item.id, 10, { status: 'running' })

    const result = await cleanup.remove(item.id)

    expect(result.deleted).toBe(false)
    expect(result.errors[0]).toMatchObject({ target: 'Thread #10' })
    expect(work.raw(item.id)?.attention).toContain('active process is not managed')
    expect(db.prepare('SELECT id FROM jobs WHERE id=10').get()).toEqual({ id: 10 })
  })

  it('stops a dashboard-managed active process before removing its thread and worktree', async () => {
    const child = { pid: 123 }
    const activeJobs = new Map([[10, child]])
    const stopProcess = vi.fn(async () => undefined)
    const { db, work, cleanup } = setup({ activeJobs, stopProcess })
    const item = work.create({ title: 'Stop and remove' })!
    insertJob(db, item.id, 10, { status: 'running' })

    const result = await cleanup.remove(item.id)

    expect(result.deleted).toBe(true)
    expect(stopProcess).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }), child)
  })

  it('automatically removes inactive merged pull-request worktrees but retains thread history', async () => {
    const { db, work, cleanup, deleteThread } = setup()
    const item = work.create({ title: 'Merged delivery', repositoryId: 1 })!
    insertJob(db, item.id, 10)
    db.prepare("UPDATE jobs SET pr_closed_at='2026-07-29',pr_merged_at='2026-07-29' WHERE id=10").run()

    const result = await cleanup.removeMergedWorktrees(1)

    expect(result).toEqual({ removed: 1, paths: ['/managed/work-1/repo'], errors: [] })
    expect(db.prepare('SELECT worktree_removed_at,thread_id FROM jobs WHERE id=10').get()).toEqual({
      worktree_removed_at: expect.any(String),
      thread_id: 'thread-10',
    })
    expect(deleteThread).not.toHaveBeenCalled()
  })

  it('retains a shared worktree while another pull request in it is still open', async () => {
    const { db, work, cleanup, run } = setup()
    const item = work.create({ title: 'Mixed pull requests', repositoryId: 1 })!
    insertJob(db, item.id, 10)
    insertJob(db, item.id, 11)
    db.prepare("UPDATE jobs SET linked_pr_number=42,pr_closed_at='2026-07-29',pr_merged_at='2026-07-29' WHERE id=10").run()
    db.prepare('UPDATE jobs SET linked_pr_number=43 WHERE id=11').run()

    const result = await cleanup.removeMergedWorktrees(1)

    expect(result).toEqual({
      removed: 0,
      paths: [],
      errors: [
        {
          target: '/managed/work-1/repo',
          error: 'Pull request #43 is still open in this worktree',
        },
      ],
    })
    expect(run).not.toHaveBeenCalled()
    expect(db.prepare('SELECT worktree_removed_at FROM jobs WHERE id=10').get()).toEqual({
      worktree_removed_at: null,
    })
  })
})

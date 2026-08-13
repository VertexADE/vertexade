import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { drizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { ensureWorkSchema } from '../database/work-schema.ts'
import { WorkMemoryService } from './memory.ts'
import { WorkService } from './service.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'work-memory-'))
  temporaryDirectories.push(root)
  const db = new DatabaseSync(':memory:')
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE repositories (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL);
    CREATE TABLE pull_requests (id INTEGER PRIMARY KEY, repo_id INTEGER, number INTEGER, title TEXT, url TEXT, draft INTEGER, review_decision TEXT, head_sha TEXT);
    CREATE TABLE jobs (id INTEGER PRIMARY KEY, repo_id INTEGER, pr_number INTEGER DEFAULT 0, worktree_path TEXT, source_job_id INTEGER,
      work_item_id INTEGER, status TEXT, kind TEXT, thread_id TEXT, agent_id TEXT, task_title TEXT, branch_name TEXT, latest_activity TEXT,
      activity_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT, input_questions TEXT, linked_pr_number INTEGER, head_sha TEXT,
      diff_files TEXT, diff_additions INTEGER DEFAULT 0, diff_deletions INTEGER DEFAULT 0);
  `)
  ensureWorkSchema(db)
  const work = new WorkService(drizzleDashboardDatabase(db))
  work.initialize()
  const item = work.create({ title: 'Shared context' })!
  const notify = vi.fn()
  return { root, work, item, memory: new WorkMemoryService(root, work, notify), notify }
}

describe('WorkMemoryService', () => {
  it('creates one stable shared Markdown file and preserves updates', async () => {
    const { memory, item, notify } = await setup()
    const initial = await memory.read(item.id)
    expect(initial.path).toBe(join(memory.directory(item.id), 'memory.md'))
    expect(initial.content).toContain(`${item.key} shared memory`)

    const updated = await memory.write(item.id, '# Decisions\n\nUse queue semantics.')
    expect(updated.content).toContain('Use queue semantics')
    expect(await readFile(updated.path, 'utf8')).toBe(updated.content)
    expect(notify).toHaveBeenCalledWith(item.id)
  })

  it('adds the memory path and writable root to every agent launch context', async () => {
    const { memory, item } = await setup()
    const launch = await memory.launchContext(item.id, 'Implement the task')
    expect(launch.prompt).toContain(`File: ${memory.path(item.id)}`)
    expect(launch.prompt).toContain('Read this file before starting')
    expect(launch.prompt).toContain('only explicitly authorized write outside the selected worktree')
    expect(launch.writableRoots).toEqual([memory.directory(item.id)])
  })

  it('keeps memory instructions before a final user request', async () => {
    const { memory, item } = await setup()
    const launch = await memory.launchContext(item.id, 'Trusted context\n\n<user_request>\nBuild it\n</user_request>')

    expect(launch.prompt.indexOf('Shared Work memory:')).toBeLessThan(launch.prompt.indexOf('<user_request>'))
    expect(launch.prompt).toMatch(/<user_request>\nBuild it\n<\/user_request>$/)
  })

  it('rejects oversized memory and removes the complete Work memory directory', async () => {
    const { memory, item } = await setup()
    await expect(memory.write(item.id, 'x'.repeat(200_001))).rejects.toThrow('cannot exceed 200 KB')
    await memory.ensure(item.id)
    expect(memory.exists(item.id)).toBe(true)
    await expect(memory.remove(item.id)).resolves.toBe(true)
    expect(memory.exists(item.id)).toBe(false)
  })

  it('refuses to follow a replaced memory-file symlink', async () => {
    const { memory, item, root } = await setup()
    const path = await memory.ensure(item.id)
    const outside = join(root, 'outside-secret')
    await writeFile(outside, 'do not read')
    await rm(path)
    await symlink(outside, path)

    await expect(memory.read(item.id)).rejects.toThrow('must be a regular file')
    expect(await readFile(outside, 'utf8')).toBe('do not read')
  })
})

import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vite-plus/test'
import { drizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { reusedCombinedWorktree } from './combined-worktree.ts'

function database(status = 'completed') {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE jobs (
    id INTEGER PRIMARY KEY, work_item_id INTEGER, repo_id INTEGER, worktree_path TEXT, status TEXT, head_sha TEXT
  )`)
  db.prepare(`INSERT INTO jobs (id,work_item_id,repo_id,worktree_path,status,head_sha)
    VALUES (1,42,7,'/managed/work-items/W-0042/acme--api',?,'original-base')`).run(status)
  return drizzleDashboardDatabase(db)
}

const allocation = {
  worktree: '/managed/work-items/W-0042/acme--api',
  created: false,
  branchName: 'feature/shared-work',
  headSha: 'current-head',
}

describe('combined repository worktree reuse', () => {
  it('keeps the original diff base and implementation branch for later runs', () => {
    const result = reusedCombinedWorktree(database(), allocation, {
      workItemId: 42,
      repositoryId: 7,
      repositoryName: 'acme/api',
      fallbackHeadSha: 'remote-main',
    })

    expect(result).toEqual({ branchName: 'feature/shared-work', headSha: 'original-base' })
  })

  it('prevents concurrent agents from editing the shared repository worktree', () => {
    expect(() =>
      reusedCombinedWorktree(database('running'), allocation, {
        workItemId: 42,
        repositoryId: 7,
        repositoryName: 'acme/api',
        fallbackHeadSha: 'remote-main',
      }),
    ).toThrow('already has an active thread #1')
  })
})

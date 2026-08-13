import { afterEach, describe, expect, it } from 'vite-plus/test'
import { migrateDashboardDatabase, openDashboardDatabase } from '../database/dashboard-database.ts'
import { createJobLogQuery } from './job-log-query.ts'

const databases: Array<{ close(): void }> = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('job log query titles', () => {
  it('uses the pull request title for legacy review threads without a task title', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    migrateDashboardDatabase(database)
    const native = database.$client
    native
      .prepare(
        "INSERT INTO repositories (id,full_name,clone_url,local_path) VALUES (1,'dovocode/vertexade','https://example.test/vertexade.git','/tmp/vertexade')",
      )
      .run()
    native
      .prepare("INSERT INTO pull_requests (repo_id,number,title,url) VALUES (1,42,'Fix thread titles','https://example.test/pr/42')")
      .run()
    native.prepare("INSERT INTO work_items (id,title,primary_repository_id) VALUES (1,'Review PR #42',1)").run()
    native
      .prepare(
        "INSERT INTO jobs (id,repo_id,pr_number,prompt,worktree_path,log_path,status,kind,work_item_id) VALUES (7,1,42,'Review','/tmp/worktree','/tmp/log','completed','review',1)",
      )
      .run()

    expect(createJobLogQuery(database).get(7)).toMatchObject({ task_title: 'Review PR #42: Fix thread titles' })
  })

  it('keeps an explicitly stored title authoritative', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    migrateDashboardDatabase(database)
    const native = database.$client
    native
      .prepare(
        "INSERT INTO repositories (id,full_name,clone_url,local_path) VALUES (1,'dovocode/vertexade','https://example.test/vertexade.git','/tmp/vertexade')",
      )
      .run()
    native.prepare("INSERT INTO pull_requests (repo_id,number,title,url) VALUES (1,42,'PR title','https://example.test/pr/42')").run()
    native.prepare("INSERT INTO work_items (id,title,primary_repository_id) VALUES (1,'Review PR #42',1)").run()
    native
      .prepare(
        "INSERT INTO jobs (id,repo_id,pr_number,prompt,worktree_path,log_path,status,kind,task_title,work_item_id) VALUES (7,1,42,'Review','/tmp/worktree','/tmp/log','completed','review','Custom review title',1)",
      )
      .run()

    expect(createJobLogQuery(database).get(7)).toMatchObject({ task_title: 'Custom review title' })
  })
})

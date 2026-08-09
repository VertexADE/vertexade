import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { openDashboardDatabase, type DrizzleDashboardDatabase } from './database/dashboard-database.ts'
import { JobFollowUpQueue } from './job-follow-up-queue.ts'

let database: DrizzleDashboardDatabase
let queue: JobFollowUpQueue

beforeEach(() => {
  database = openDashboardDatabase(':memory:')
  database.$client
    .prepare(`INSERT INTO repositories (id, full_name, clone_url, local_path) VALUES (1, 'owner/repo', 'git@example/repo', '/repo')`)
    .run()
  database.$client
    .prepare(
      "INSERT INTO work_items (id,key,title,kind,state,primary_repository_id) VALUES (1,'W-0001','Task','implementation','active',1)",
    )
    .run()
  database.$client
    .prepare(`INSERT INTO jobs (id, repo_id, pr_number, prompt, worktree_path, log_path, status, work_item_id)
    VALUES (1, 1, 0, 'task', '/worktree', '/log', 'running', 1)`)
    .run()
  queue = new JobFollowUpQueue(database)
})

afterEach(() => database.close())

describe('job follow-up queue', () => {
  it('claims follow-ups in insertion order and tracks their lifecycle', () => {
    expect(queue.enqueue(1, 'first', 'gpt-5.6-sol', 'high')).toMatchObject({
      position: 1,
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
    })
    expect(queue.enqueue(1, 'second')).toMatchObject({ position: 2 })

    expect(queue.claim(1)).toMatchObject({
      prompt: 'first',
      status: 'running',
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
    })
    expect(queue.list(1)).toEqual([expect.objectContaining({ prompt: 'second', model: null, reasoning_effort: null })])
    expect(queue.finishRunning(1, true)).toBe(true)
    expect(queue.claim(1)).toMatchObject({ prompt: 'second' })
  })

  it('recovers a running queue entry after its job already finished', () => {
    queue.enqueue(1, 'next')
    queue.claim(1)
    database.$client.prepare("UPDATE jobs SET status='completed', exit_code=0 WHERE id=1").run()

    expect(queue.recoverFinishedJobs()).toBe(1)
    expect(queue.hasPending(1)).toBe(false)
  })

  it('keeps waiting turns aligned with newly detected thread context', () => {
    queue.enqueue(1, 'next', 'old-model', 'low')
    expect(queue.updateQueuedContext(1, 'new-model', 'high')).toBe(1)
    expect(queue.list(1)[0]).toMatchObject({ model: 'new-model', reasoning_effort: 'high' })
  })

  it('completes a specific queued message after it is used to steer', () => {
    const first = queue.enqueue(1, 'first')
    const second = queue.enqueue(1, 'second')

    expect(queue.queued(1, second.id)).toMatchObject({ prompt: 'second', status: 'queued' })
    expect(queue.completeQueued(1, second.id)).toBe(true)
    expect(queue.completeQueued(1, second.id)).toBe(false)
    expect(queue.list(1)).toEqual([expect.objectContaining({ id: first.id, prompt: 'first' })])
  })

  it('removes only a still-queued message', () => {
    const first = queue.enqueue(1, 'first')
    const second = queue.enqueue(1, 'second')

    expect(queue.removeQueued(1, first.id)).toBe(true)
    expect(queue.removeQueued(1, first.id)).toBe(false)
    expect(queue.list(1)).toEqual([expect.objectContaining({ id: second.id, prompt: 'second' })])
  })
})

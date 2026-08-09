import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { CleanupTombstoneStore } from './cleanup-tombstones.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('cleanup tombstones', () => {
  it('persists retry ownership across a database restart and remains idempotent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vertexade-cleanup-tombstone-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'dashboard.sqlite')
    let database = openDashboardDatabase(path)
    let store = new CleanupTombstoneStore(database)
    const tombstoneId = store.ensure({ id: 7, key: 'W-0007', title: 'Durable cleanup' }, [
      { identity: 'job:11:provider', jobId: 11, kind: 'provider_thread', target: 'session-11' },
    ])
    store.fail(tombstoneId, 'job:11:provider', new Error('provider unavailable'))
    expect(
      store.ensure({ id: 7, key: 'W-0007', title: 'Durable cleanup' }, [
        { identity: 'job:11:provider', jobId: 11, kind: 'provider_thread', target: 'session-11' },
      ]),
    ).toBe(tombstoneId)
    database.close()

    database = openDashboardDatabase(path)
    store = new CleanupTombstoneStore(database)
    expect(store.listIncomplete()).toMatchObject([
      {
        id: tombstoneId,
        work_item_key: 'W-0007',
        pending: 1,
        artifacts: [{ state: 'retrying', attempts: 1, target: 'session-11' }],
      },
    ])
    database.close()
  })

  it('requires the exact Work key before explicitly detaching a blocked artifact', () => {
    const database = openDashboardDatabase(':memory:')
    const store = new CleanupTombstoneStore(database)
    const tombstoneId = store.ensure({ id: 8, key: 'W-0008', title: 'Blocked cleanup' }, [
      { identity: 'job:12:log', jobId: 12, kind: 'log', target: '/unmanaged/12.log' },
    ])
    store.fail(tombstoneId, 'job:12:log', new Error('outside canonical root'), true)
    const artifact = store.artifacts(tombstoneId)[0]

    expect(store.detach(artifact.id, 'W-9999')).toBeNull()
    expect(store.detach(artifact.id, 'W-0008')).toMatchObject({ state: 'detached' })
    expect(store.summary(tombstoneId)).toMatchObject({ state: 'complete', pending: 0 })
    database.close()
  })
})

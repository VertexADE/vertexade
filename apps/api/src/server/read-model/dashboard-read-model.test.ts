import { describe, expect, it, vi } from 'vite-plus/test'
import { DashboardReadModelStore, type DashboardReadModelSnapshot } from './dashboard-read-model.ts'

function snapshot(repositoryName = 'vertexade/app'): DashboardReadModelSnapshot {
  return {
    repositories: [{ key: '1', value: { id: 1, full_name: repositoryName }, sourceUpdatedAt: null, position: 0 }],
    pullRequests: [],
    agentThreads: [],
    dashboardMeta: [{ key: 'current', value: { presets: [] }, sourceUpdatedAt: null, position: 0 }],
    workItems: [],
  }
}

describe('DashboardReadModelStore', () => {
  it('returns a full initial model and only changed collections afterwards', async () => {
    let current = snapshot()
    let now = 100
    const store = new DashboardReadModelStore({
      snapshot: () => current,
      instanceId: 'server-a',
      now: () => now,
    })

    const initial = await store.changes()
    expect(initial.version).toBe(100)
    expect(Object.keys(initial.updates)).toEqual(['repositories', 'pullRequests', 'agentThreads', 'dashboardMeta', 'workItems'])
    expect(initial.updates.repositories).toMatchObject({
      mode: 'replace',
      entries: [{ key: '1', value: { id: 1, full_name: 'vertexade/app' } }],
    })

    expect(await store.changes(initial.version, initial.instanceId)).toEqual({
      instanceId: 'server-a',
      version: 100,
      updates: {},
    })

    current = snapshot('vertexade/dashboard')
    now = 101
    const changed = await store.changes(initial.version, initial.instanceId)
    expect(changed.version).toBe(101)
    expect(Object.keys(changed.updates)).toEqual(['repositories'])
    expect(changed.updates.repositories).toEqual({
      version: 101,
      mode: 'patch',
      upserts: [
        {
          key: '1',
          value: { id: 1, full_name: 'vertexade/dashboard' },
          sourceUpdatedAt: null,
          position: 0,
        },
      ],
      deletes: [],
    })
  })

  it('falls back to a replacement when a client missed an earlier patch', async () => {
    let current = snapshot()
    let now = 100
    const store = new DashboardReadModelStore({
      snapshot: () => current,
      instanceId: 'server-a',
      now: () => now,
    })
    await store.changes()

    current = snapshot('vertexade/dashboard')
    now = 101
    await store.refresh()
    current = snapshot('vertexade/web')
    now = 102
    await store.refresh()

    const changes = await store.changes(100, 'server-a')
    expect(changes.updates.repositories).toMatchObject({
      version: 102,
      mode: 'replace',
      entries: [{ key: '1', value: { id: 1, full_name: 'vertexade/web' } }],
    })
  })

  it('patches individual additions and removals', async () => {
    let current = snapshot()
    let now = 100
    const store = new DashboardReadModelStore({
      snapshot: () => current,
      instanceId: 'server-a',
      now: () => now,
    })
    const initial = await store.changes()

    current = {
      ...current,
      repositories: [
        {
          key: '2',
          value: { id: 2, full_name: 'vertexade/web' },
          sourceUpdatedAt: null,
          position: 0,
        },
      ],
    }
    now = 101
    const changes = await store.changes(initial.version, initial.instanceId)
    expect(changes.updates.repositories).toEqual({
      version: 101,
      mode: 'patch',
      upserts: current.repositories,
      deletes: ['1'],
    })
  })

  it('coalesces scheduled refreshes', async () => {
    vi.useFakeTimers()
    const source = vi.fn(() => snapshot())
    const store = new DashboardReadModelStore({
      snapshot: source,
      debounceMs: 50,
      instanceId: 'server-a',
    })
    store.schedule()
    store.schedule()
    await vi.advanceTimersByTimeAsync(50)
    expect(source).toHaveBeenCalledTimes(1)
    expect(store.status()).toMatchObject({
      instanceId: 'server-a',
      refreshCount: 1,
      lastChangedCollections: ['repositories', 'pullRequests', 'agentThreads', 'dashboardMeta', 'workItems'],
      lastError: null,
    })
    store.stop()
    vi.useRealTimers()
  })

  it('sends a full snapshot when a client version is newer than this server instance', async () => {
    const store = new DashboardReadModelStore({ snapshot, instanceId: 'server-a', now: () => 100 })
    const changes = await store.changes(10_000, 'server-a')
    expect(Object.keys(changes.updates)).toEqual(['repositories', 'pullRequests', 'agentThreads', 'dashboardMeta', 'workItems'])
    expect(changes.updates.repositories?.mode).toBe('replace')
  })

  it('sends a replacement when the API instance changed so stale deletions cannot survive', async () => {
    const before = new DashboardReadModelStore({
      snapshot: () => ({
        ...snapshot(),
        repositories: [
          { key: '1', value: { id: 1 }, sourceUpdatedAt: null, position: 0 },
          { key: '2', value: { id: 2 }, sourceUpdatedAt: null, position: 1 },
        ],
      }),
      instanceId: 'server-a',
      now: () => 100,
    })
    const initial = await before.changes()
    const after = new DashboardReadModelStore({
      snapshot,
      instanceId: 'server-b',
      now: () => 200,
    })

    const changes = await after.changes(initial.version, initial.instanceId)

    expect(changes.instanceId).toBe('server-b')
    expect(changes.updates.repositories).toMatchObject({
      mode: 'replace',
      entries: [{ key: '1' }],
    })
  })
})

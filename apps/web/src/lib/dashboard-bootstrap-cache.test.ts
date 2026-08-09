import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

function fakeWindow() {
  const values = new Map<string, string>()
  return {
    values,
    window: {
      localStorage: {
        getItem(key: string) {
          return values.get(key) ?? null
        },
        setItem(key: string, value: string) {
          values.set(key, value)
        },
      },
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('dashboard bootstrap cache', () => {
  it('publishes a snapshot only after its manifest version is committed', async () => {
    const storage = fakeWindow()
    vi.stubGlobal('window', storage.window)
    const cache = await import('./dashboard-bootstrap-cache.ts')

    cache.writeDashboardBootstraps(
      {
        repositories: [{ id: 1, full_name: 'vertexade/app' }],
      },
      100,
      '2026-07-28T00:00:00.000Z',
    )

    expect(cache.readDashboardBootstrap('repositories')).toMatchObject({
      serverVersion: 100,
      values: [{ id: 1, full_name: 'vertexade/app' }],
    })
  })

  it('rejects a partially staged collection whose manifest still points at an older version', async () => {
    const storage = fakeWindow()
    vi.stubGlobal('window', storage.window)
    const cache = await import('./dashboard-bootstrap-cache.ts')
    cache.writeDashboardBootstraps(
      {
        repositories: [{ id: 1 }],
      },
      100,
      '2026-07-28T00:00:00.000Z',
    )

    storage.values.set(
      'vertexade:dashboard-bootstrap:v3:repositories',
      JSON.stringify({
        schemaVersion: 3,
        serverVersion: 200,
        syncedAt: '2026-07-28T00:01:00.000Z',
        values: [{ id: 2 }],
      }),
    )
    vi.resetModules()
    const reloaded = await import('./dashboard-bootstrap-cache.ts')

    expect(reloaded.readDashboardBootstrap('repositories')).toBeNull()
  })

  it('ignores snapshots from the previous cache contract', async () => {
    const storage = fakeWindow()
    storage.values.set(
      'vertexade:dashboard-bootstrap:v2:workItems',
      JSON.stringify({
        schemaVersion: 2,
        serverVersion: 100,
        syncedAt: '2026-07-28T00:00:00.000Z',
        values: [{ id: 1, title: 'Stale work' }],
      }),
    )
    vi.stubGlobal('window', storage.window)
    const cache = await import('./dashboard-bootstrap-cache.ts')

    expect(cache.readDashboardBootstrap('workItems')).toBeNull()
  })
})

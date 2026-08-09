import { describe, expect, it, vi } from 'vite-plus/test'
import { ExtensionCacheStore } from './cache.ts'

describe('ExtensionCacheStore', () => {
  it('isolates namespaces and reports fresh cache hits', async () => {
    const store = new ExtensionCacheStore()
    const left = store.scope('left')
    const right = store.scope('right')
    const load = vi.fn(async () => ({ value: 1 }))

    const miss = await left.getOrLoad('overview', load, { ttlMs: 1_000 })
    const hit = await left.getOrLoad('overview', load, { ttlMs: 1_000 })
    const other = await right.getOrLoad('overview', load, { ttlMs: 1_000 })

    expect(miss.cache.state).toBe('miss')
    expect(hit.cache.state).toBe('fresh')
    expect(other.cache.state).toBe('miss')
    expect(load).toHaveBeenCalledTimes(2)
    expect(left.stats()).toMatchObject({
      namespace: 'left',
      entries: 1,
      hits: 1,
      misses: 1,
      refreshes: 1,
    })
    expect(store.stats()).toMatchObject({ namespace: 'core', entries: 0 })
  })

  it('returns stale data while coalescing a background refresh', async () => {
    vi.useFakeTimers()
    const cache = new ExtensionCacheStore().scope('extension')
    let release: ((value: number) => void) | undefined
    await cache.getOrLoad('board', async () => 1, { ttlMs: 10, staleWhileRevalidateMs: 100 })
    await vi.advanceTimersByTimeAsync(20)
    const refresh = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = resolve
        }),
    )

    const stale = await cache.getOrLoad('board', refresh, {
      ttlMs: 10,
      staleWhileRevalidateMs: 100,
    })
    const coalesced = await cache.getOrLoad('board', refresh, {
      ttlMs: 10,
      staleWhileRevalidateMs: 100,
    })
    expect(stale).toMatchObject({ value: 1, cache: { state: 'stale', refreshing: true } })
    expect(coalesced.value).toBe(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    release?.(2)
    await vi.runAllTimersAsync()
    const fresh = await cache.getOrLoad('board', refresh, {
      ttlMs: 10,
      staleWhileRevalidateMs: 100,
    })
    expect(fresh.value).toBe(2)
    vi.useRealTimers()
  })

  it('waits for force refresh and invalidates matching tags', async () => {
    const cache = new ExtensionCacheStore().scope('extension')
    await cache.getOrLoad('board:one', async () => 1, { ttlMs: 1_000, tags: ['board'] })
    const refreshed = await cache.getOrLoad('board:one', async () => 2, {
      ttlMs: 1_000,
      tags: ['board'],
      forceRefresh: true,
    })
    await cache.getOrLoad('details:one', async () => 3, { ttlMs: 1_000, tags: ['details'] })

    expect(refreshed).toMatchObject({ value: 2, cache: { state: 'refreshed', refreshing: false } })
    expect(cache.invalidate({ tags: ['board'] })).toBe(1)
    expect(cache.stats().entries).toBe(1)
  })

  it('coalesces concurrent misses', async () => {
    const cache = new ExtensionCacheStore().scope('extension')
    let release: ((value: number) => void) | undefined
    const load = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = resolve
        }),
    )
    const first = cache.getOrLoad('key', load, { ttlMs: 1_000 })
    const second = cache.getOrLoad('key', load, { ttlMs: 1_000 })
    await Promise.resolve()
    release?.(4)

    await expect(Promise.all([first, second])).resolves.toMatchObject([{ value: 4 }, { value: 4 }])
    expect(load).toHaveBeenCalledTimes(1)
    expect(cache.stats().coalesced).toBe(1)
  })

  it('does not repopulate an invalidated cache from an in-flight load', async () => {
    const cache = new ExtensionCacheStore().scope('extension')
    let release: ((value: number) => void) | undefined
    const pending = cache.getOrLoad(
      'board',
      () =>
        new Promise<number>((resolve) => {
          release = resolve
        }),
      { ttlMs: 1_000 },
    )
    await Promise.resolve()
    cache.invalidate()
    release?.(1)
    await expect(pending).resolves.toMatchObject({ value: 1 })
    expect(cache.stats().entries).toBe(0)
  })
})

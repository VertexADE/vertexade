import { describe, expect, it, vi } from 'vite-plus/test'
import { extensionDataCacheOptions, loadExtensionData, loadExtensionDataEffect, publishExtensionChange } from './extension-data.ts'
import { runApiEffect } from './effect/index.ts'

describe('extension data lifecycle', () => {
  it('uses one cache policy for provider boards and references', () => {
    expect(extensionDataCacheOptions(true)).toEqual({
      ttlMs: 30_000,
      staleWhileRevalidateMs: 120_000,
      tags: ['board', 'references'],
      forceRefresh: true,
    })
  })

  it('loads directly when the extension cache is unavailable', async () => {
    const loader = vi.fn(async () => ({ records: 3 }))

    await expect(loadExtensionData({}, 'board:records', loader)).resolves.toEqual({
      value: { records: 3 },
      cache: undefined,
    })
    expect(loader).toHaveBeenCalledOnce()
  })

  it('exposes provider failures through the typed Effect error channel', async () => {
    const program = loadExtensionDataEffect({}, 'board:records', async () => {
      throw new Error('provider offline')
    })

    await expect(runApiEffect(program)).rejects.toMatchObject({
      status: 502,
      message: 'Extension data could not be loaded: provider offline',
    })
  })

  it('invalidates extension data before publishing a scoped change', () => {
    const calls: string[] = []
    const host = {
      cache: {
        invalidate: vi.fn(() => {
          calls.push('invalidate')
          return 1
        }),
      },
      events: {
        emit: vi.fn(() => {
          calls.push('emit')
        }),
      },
    }

    publishExtensionChange(host as never, 'airtable_record_updated', 42)

    expect(calls).toEqual(['invalidate', 'emit'])
    expect(host.cache.invalidate).toHaveBeenCalledWith({ tags: ['board', 'references'] })
    expect(host.events.emit).toHaveBeenCalledWith('airtable_record_updated', 42)
  })
})

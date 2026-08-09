import { PLATFORM_API_VERSION } from '@vertexade/platform-contracts'
import { describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { ExtensionRegistry } from './registry.ts'
import { ExtensionStateCoordinator, ExtensionStateStore } from './state-coordinator.ts'

function extension(lifecycle: { initialize?(): void | Promise<void>; dispose?(): void | Promise<void> } = {}) {
  return {
    manifest: {
      id: 'example',
      name: 'Example',
      version: '1.0.0',
      platformApi: PLATFORM_API_VERSION,
      kind: 'other' as const,
    },
    ...lifecycle,
  }
}

function fixture({
  initialize,
  dispose,
  syncTriggers = vi.fn(async () => undefined),
  invalidateNamespace = vi.fn(() => 0),
  notify = vi.fn(),
}: {
  initialize?(): void | Promise<void>
  dispose?(): void | Promise<void>
  syncTriggers?: () => Promise<void>
  invalidateNamespace?: (id: string) => number
  notify?: (reason: string) => void
} = {}) {
  const database = openDashboardDatabase(':memory:')
  const extensions = new ExtensionRegistry().install(extension({ initialize, dispose }), { enabled: true })
  const store = new ExtensionStateStore(database)
  const coordinator = new ExtensionStateCoordinator({
    store,
    extensions,
    syncTriggers,
    cache: { invalidateNamespace } as any,
    notify,
  })
  coordinator.registerInstalled()
  return { database, extensions, store, coordinator, syncTriggers, invalidateNamespace, notify }
}

describe('extension state coordinator', () => {
  it('migrates legacy desired state once without overwriting the durable source of truth', () => {
    const database = openDashboardDatabase(':memory:')
    const store = new ExtensionStateStore(database)
    store.seedLegacy({ example: false })
    store.seedLegacy({ example: true })
    expect(store.read('example')).toMatchObject({ desiredEnabled: false, appliedEnabled: false, phase: 'stable' })
    database.close()
  })

  it('commits desired and applied state only after the full disable lifecycle succeeds', async () => {
    const dispose = vi.fn()
    const current = fixture({ dispose })

    const result = await current.coordinator.toggle('example', false)

    expect(result).toMatchObject({ ok: true, desiredEnabled: false, appliedEnabled: false, phase: 'stable', pending: false })
    expect(current.extensions.installed('example')?.enabled).toBe(false)
    expect(dispose).toHaveBeenCalledOnce()
    expect(current.syncTriggers).toHaveBeenCalledOnce()
    expect(current.invalidateNamespace).toHaveBeenCalledWith('example')
    expect(current.notify).toHaveBeenCalledWith('extensions_updated')
    current.database.close()
  })

  it('re-enables a previously disabled extension through the same durable lifecycle', async () => {
    const initialize = vi.fn()
    const dispose = vi.fn()
    const current = fixture({ initialize, dispose })

    await current.coordinator.toggle('example', false)
    const enabled = await current.coordinator.toggle('example', true)

    expect(enabled).toMatchObject({ ok: true, desiredEnabled: true, appliedEnabled: true, pending: false })
    expect(current.extensions.installed('example')?.enabled).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
    expect(initialize).toHaveBeenCalledOnce()
    current.database.close()
  })

  it('rolls runtime back and preserves a durable repair task when trigger synchronization fails', async () => {
    const initialize = vi.fn()
    const dispose = vi.fn()
    let failSync = true
    const current = fixture({
      initialize,
      dispose,
      syncTriggers: vi.fn(async () => {
        if (failSync) {
          failSync = false
          throw new Error('trigger subscription failed')
        }
      }),
    })

    const failed = await current.coordinator.toggle('example', false)
    expect(failed).toMatchObject({
      ok: false,
      desiredEnabled: false,
      appliedEnabled: true,
      phase: 'repair_required',
      pending: true,
      error: 'trigger subscription failed',
    })
    expect(current.extensions.installed('example')?.enabled).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
    expect(initialize).toHaveBeenCalledOnce()

    const retried = await current.coordinator.toggle('example', false)
    expect(retried).toMatchObject({ ok: true, desiredEnabled: false, appliedEnabled: false, pending: false })
    current.database.close()
  })

  it('keeps lifecycle failures retryable and reports the observed runtime state', async () => {
    let unavailable = true
    const dispose = vi.fn(async () => {
      if (unavailable) throw new Error('dispose unavailable')
    })
    const current = fixture({ dispose })

    const failed = await current.coordinator.toggle('example', false)
    expect(failed).toMatchObject({ ok: false, desiredEnabled: false, appliedEnabled: true, pending: true })
    expect(current.extensions.installed('example')?.enabled).toBe(true)

    unavailable = false
    const retried = await current.coordinator.toggle('example', false)
    expect(retried).toMatchObject({ ok: true, appliedEnabled: false, pending: false })
    expect(dispose).toHaveBeenCalledTimes(2)
    current.database.close()
  })

  it('reconciles a failed initialized lifecycle during startup', async () => {
    const initialize = vi.fn()
    const current = fixture({ initialize })
    current.extensions.fail('example', 'initialize', new Error('startup unavailable'))
    current.coordinator.registerInstalled()
    expect(current.store.read('example')).toMatchObject({ phase: 'repair_required', pending: true })

    await current.coordinator.reconcile()

    expect(initialize).toHaveBeenCalledOnce()
    expect(current.store.read('example')).toMatchObject({ phase: 'stable', appliedEnabled: true, pending: false })
    current.database.close()
  })

  it('does not roll back a stable transition when client notification fails', async () => {
    const current = fixture({
      notify: () => {
        throw new Error('event channel closed')
      },
    })

    const result = await current.coordinator.toggle('example', false)

    expect(result).toMatchObject({ ok: true, appliedEnabled: false, pending: false })
    expect(result.warning).toContain('notification failed')
    expect(current.store.read('example')).toMatchObject({ phase: 'stable', appliedEnabled: false })
    current.database.close()
  })

  it('rolls back and records repair when cache invalidation fails', async () => {
    let unavailable = true
    const current = fixture({
      invalidateNamespace: () => {
        if (unavailable) throw new Error('cache unavailable')
        return 0
      },
    })

    const failed = await current.coordinator.toggle('example', false)
    expect(failed).toMatchObject({ ok: false, desiredEnabled: false, appliedEnabled: true, pending: true })
    expect(failed.error).toContain('cache unavailable')

    unavailable = false
    const retried = await current.coordinator.toggle('example', false)
    expect(retried).toMatchObject({ ok: true, appliedEnabled: false, pending: false })
    current.database.close()
  })

  it('rolls runtime back when the final stable-state write fails', async () => {
    const initialize = vi.fn()
    const dispose = vi.fn()
    const current = fixture({ initialize, dispose })
    vi.spyOn(current.store, 'stable').mockImplementationOnce(() => {
      throw new Error('database write failed')
    })

    const result = await current.coordinator.toggle('example', false)

    expect(result).toMatchObject({ ok: false, desiredEnabled: false, appliedEnabled: true, pending: true })
    expect(result.error).toContain('database write failed')
    expect(current.extensions.installed('example')?.enabled).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
    expect(initialize).toHaveBeenCalledOnce()
    current.database.close()
  })

  it('serializes concurrent requests for the same extension', async () => {
    let active = 0
    let maximum = 0
    const current = fixture({
      dispose: async () => {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => {
          setTimeout(resolve, 5)
        })
        active -= 1
      },
    })

    await Promise.all([current.coordinator.toggle('example', false), current.coordinator.toggle('example', false)])

    expect(maximum).toBe(1)
    expect(current.store.read('example')).toMatchObject({ phase: 'stable', appliedEnabled: false })
    current.database.close()
  })
})

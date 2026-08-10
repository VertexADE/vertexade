import { useEffect, useLayoutEffect, useState } from 'react'
import { auditTime, BehaviorSubject, filter } from 'rxjs'
import { platformClient, platformConnectionState, platformEventMessages } from '@vertexade/ui/lib/dashboard-api'
import {
  dashboardCollections,
  maxFederatedReadModelResponseBytes,
  normalizeDashboardCollectionValues,
  type DashboardCollection,
  type ReadModelResponse,
} from './dashboard-cache-model'
import { readDashboardBootstrap, writeDashboardBootstraps } from './dashboard-bootstrap-cache'

type ConnectionState = {
  connected: boolean
  lastSyncedAt: string | null
}

type DashboardStorage = typeof import('./rxdb-dashboard-storage')

const connectionState = new BehaviorSubject<ConnectionState>({
  connected: false,
  lastSyncedAt: null,
})
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

let storagePromise: Promise<DashboardStorage> | undefined
let syncPromise: Promise<void> | undefined
let syncRequested = false
let eventSubscription: { unsubscribe(): void } | undefined
let syncScheduled = false
let visibilityListenerInstalled = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryDelay = 1_000

function storage() {
  storagePromise ??= import('./rxdb-dashboard-storage')
  return storagePromise
}

function reportSyncError(error: unknown) {
  console.warn('Could not update the local dashboard cache:', error)
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    void syncDashboardCache().catch(reportSyncError)
  }, retryDelay)
  retryDelay = Math.min(retryDelay * 2, 30_000)
}

async function syncOnce() {
  const localStorage = await storage()
  const syncState = await localStorage.readDashboardSyncState()
  const since = syncState?.version ?? 0
  try {
    const search = new URLSearchParams({ since: String(since) })
    if (syncState?.instanceId) search.set('instance', syncState.instanceId)
    const payload = await platformClient.request<ReadModelResponse>(`/api/read-model?${search}`, {
      headers: { accept: 'application/json' },
      maxJsonResponseBytes: maxFederatedReadModelResponseBytes,
    })
    const syncedAt = new Date().toISOString()
    const updatedCollections: Partial<Record<DashboardCollection, Record<string, unknown>[]>> = {}
    for (const collection of dashboardCollections) {
      const update = payload.updates[collection]
      if (!update) continue
      await localStorage.applyDashboardUpdate(collection, update)
      updatedCollections[collection] = await localStorage.readDashboardCollection(collection)
    }
    await localStorage.writeDashboardSyncState(payload.instanceId, payload.version, syncedAt)
    writeDashboardBootstraps(updatedCollections, payload.version, syncedAt)
    clearTimeout(retryTimer)
    retryDelay = 1_000
    connectionState.next({ connected: true, lastSyncedAt: syncedAt })
  } catch (error) {
    connectionState.next({
      connected: false,
      lastSyncedAt: connectionState.value.lastSyncedAt,
    })
    throw error
  }
}

function syncDashboardCache() {
  syncRequested = true
  if (syncPromise !== undefined) return syncPromise
  syncPromise = (async () => {
    while (syncRequested) {
      syncRequested = false
      await syncOnce()
    }
  })().finally(() => {
    syncPromise = undefined
  })
  return syncPromise
}

function scheduleSync() {
  if (syncScheduled) return
  syncScheduled = true
  queueMicrotask(() => {
    syncScheduled = false
    void syncDashboardCache().catch(reportSyncError)
  })
}

function startDashboardSync() {
  if (typeof window === 'undefined' || eventSubscription !== undefined) return
  eventSubscription = platformEventMessages()
    .pipe(
      filter(
        ({ data }) =>
          !['action_started', 'action_updated', 'action_completed', 'agent_message', 'diff', 'thread_context_updated'].includes(
            data.reason,
          ),
      ),
      auditTime(120),
    )
    .subscribe(() => scheduleSync())
  platformConnectionState().subscribe((state) => {
    if (!state.connected) {
      connectionState.next({
        connected: false,
        lastSyncedAt: connectionState.value.lastSyncedAt,
      })
    }
  })
  if (!visibilityListenerInstalled) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleSync()
    })
    visibilityListenerInstalled = true
  }
  scheduleSync()
}

export function useRxDashboardCollection<T extends object>(collection: DashboardCollection, fallback: T[] = []) {
  const [values, setValues] = useState<T[]>(() => normalizeDashboardCollectionValues(collection, fallback))
  const [ready, setReady] = useState(false)
  const [connection, setConnection] = useState(connectionState.value)

  useBrowserLayoutEffect(() => {
    let active = true
    let modelSubscription: { unsubscribe(): void } | undefined
    const bootstrap = readDashboardBootstrap<T>(collection)
    if (bootstrap) {
      setValues(normalizeDashboardCollectionValues(collection, bootstrap.values))
      setReady(true)
      setConnection((current) => ({
        ...current,
        lastSyncedAt: current.lastSyncedAt ?? bootstrap.syncedAt,
      }))
    }
    let initialConnection = true
    const connectionSubscription = connectionState.subscribe((next) => {
      if (initialConnection) {
        initialConnection = false
        return
      }
      setConnection(next)
      if (next.lastSyncedAt) setReady(true)
    })
    void storage()
      .then(async (dashboardStorage) => {
        const cachedSync = await dashboardStorage.readDashboardSyncState()
        if (!active) return
        modelSubscription = await dashboardStorage.subscribeDashboardCollection(collection, (nextValues) => {
          if (!active) return
          setValues(normalizeDashboardCollectionValues(collection, nextValues as T[]))
          if (cachedSync) setReady(true)
        })
        if (!active) {
          modelSubscription.unsubscribe()
          return
        }
        startDashboardSync()
      })
      .catch(reportSyncError)
    return () => {
      active = false
      modelSubscription?.unsubscribe()
      connectionSubscription.unsubscribe()
    }
  }, [collection])

  return {
    values,
    ready,
    connected: connection.connected,
    lastSyncedAt: connection.lastSyncedAt,
    refresh: syncDashboardCache,
  }
}

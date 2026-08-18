import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { auditTime, BehaviorSubject, filter, merge } from 'rxjs'
import { platformClient, platformConnectionState, platformEventMessages } from '@vertexade/ui/lib/dashboard-api'
import { browserPairedServersStorageKey, hasBrowserPairedServers } from '@vertexade/ui/lib/browser-paired-servers'
import {
  dashboardCollections,
  maxFederatedReadModelResponseBytes,
  normalizeDashboardCollectionValues,
  type DashboardCollection,
  type ReadModelResponse,
} from './dashboard-cache-model'
import { readDashboardBootstrap, writeDashboardBootstraps } from './dashboard-bootstrap-cache'
import { useDashboardModelRows } from './tanstack-dashboard-db'

type ConnectionState = {
  connected: boolean
  lastSyncedAt: string | null
  error: string | null
}

type DashboardStorage = typeof import('./rxdb-dashboard-storage')

const connectionState = new BehaviorSubject<ConnectionState>({
  connected: false,
  lastSyncedAt: null,
  error: null,
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
let pairedServerPoll: ReturnType<typeof setInterval> | undefined
let pairedServerListenerInstalled = false

const deferredDashboardEvents = new Set(['action_started', 'action_updated', 'action_completed', 'thread_context_updated'])
const summaryDashboardEvents = new Set(['agent_message', 'diff'])

export function dashboardEventSyncLane(reason: string): 'immediate' | 'summary' | null {
  if (deferredDashboardEvents.has(reason)) return null
  return summaryDashboardEvents.has(reason) ? 'summary' : 'immediate'
}

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
    connectionState.next({ connected: true, lastSyncedAt: syncedAt, error: null })
  } catch (error) {
    connectionState.next({
      connected: false,
      lastSyncedAt: connectionState.value.lastSyncedAt,
      error: error instanceof Error ? error.message : String(error),
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

function updatePairedServerPoll() {
  if (hasBrowserPairedServers()) {
    pairedServerPoll ??= setInterval(() => {
      if (!document.hidden) scheduleSync()
    }, 5_000)
    return
  }
  if (pairedServerPoll) clearInterval(pairedServerPoll)
  pairedServerPoll = undefined
}

function startDashboardSync() {
  if (typeof window === 'undefined' || eventSubscription !== undefined) return
  const events = platformEventMessages()
  eventSubscription = merge(
    events.pipe(
      filter(({ data }) => dashboardEventSyncLane(data.reason) === 'immediate'),
      auditTime(120),
    ),
    events.pipe(
      filter(({ data }) => dashboardEventSyncLane(data.reason) === 'summary'),
      auditTime(500),
    ),
  ).subscribe(() => scheduleSync())
  platformConnectionState().subscribe((state) => {
    if (!state.connected) {
      connectionState.next({
        connected: false,
        lastSyncedAt: connectionState.value.lastSyncedAt,
        error: state.error,
      })
    }
  })
  if (!visibilityListenerInstalled) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleSync()
    })
    visibilityListenerInstalled = true
  }
  if (!pairedServerListenerInstalled) {
    window.addEventListener('vertexade:paired-servers', () => {
      updatePairedServerPoll()
      scheduleSync()
    })
    window.addEventListener('storage', (event) => {
      if (event.key === browserPairedServersStorageKey) {
        updatePairedServerPoll()
        scheduleSync()
      }
    })
    pairedServerListenerInstalled = true
  }
  updatePairedServerPoll()
  scheduleSync()
}

export function useRxDashboardCollection<T extends object>(collection: DashboardCollection, fallback: T[] = []) {
  const [connection, setConnection] = useState(connectionState.value)
  const models = useDashboardModelRows(collection)
  const bootstrap = useMemo(() => readDashboardBootstrap<T>(collection), [collection])
  const fallbackValues = bootstrap?.values ?? fallback
  const values = normalizeDashboardCollectionValues(
    collection,
    models.isReady ? (models.data ?? []).map((document) => document.value as T) : fallbackValues,
  )
  const ready = models.isReady || Boolean(bootstrap)

  useBrowserLayoutEffect(() => {
    if (bootstrap) {
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
    })
    startDashboardSync()
    return () => {
      connectionSubscription.unsubscribe()
    }
  }, [bootstrap])

  return {
    values,
    ready,
    connected: connection.connected,
    error: connection.error,
    lastSyncedAt: connection.lastSyncedAt,
    refresh: syncDashboardCache,
  }
}

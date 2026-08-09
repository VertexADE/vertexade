import type { DashboardCollection } from './dashboard-cache-model'

type BootstrapSnapshot<T extends object = object> = {
  schemaVersion: 3
  serverVersion: number
  syncedAt: string
  values: T[]
}

type BootstrapManifest = {
  schemaVersion: 3
  collections: Partial<Record<DashboardCollection, number>>
}

const bootstrapPrefix = 'vertexade:dashboard-bootstrap:v3:'
const manifestKey = `${bootstrapPrefix}manifest`
const memoryCache = new Map<DashboardCollection, BootstrapSnapshot<object> | null>()
let memoryManifest: BootstrapManifest | undefined

function storageKey(collection: DashboardCollection) {
  return `${bootstrapPrefix}${collection}`
}

function validSnapshot(value: unknown): value is BootstrapSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<BootstrapSnapshot>
  return (
    snapshot.schemaVersion === 3 &&
    typeof snapshot.serverVersion === 'number' &&
    typeof snapshot.syncedAt === 'string' &&
    Array.isArray(snapshot.values)
  )
}

function manifest(): BootstrapManifest {
  if (memoryManifest) return memoryManifest
  const empty: BootstrapManifest = { schemaVersion: 3, collections: {} }
  if (typeof window === 'undefined') return empty
  try {
    const parsed = JSON.parse(window.localStorage.getItem(manifestKey) || '') as Partial<BootstrapManifest>
    if (parsed.schemaVersion === 3 && parsed.collections && typeof parsed.collections === 'object') {
      memoryManifest = { schemaVersion: 3, collections: parsed.collections }
      return memoryManifest
    }
  } catch {}
  memoryManifest = empty
  return empty
}

export function readDashboardBootstrap<T extends object>(collection: DashboardCollection): BootstrapSnapshot<T> | null {
  if (typeof window === 'undefined') return null
  if (memoryCache.has(collection)) {
    return memoryCache.get(collection) as BootstrapSnapshot<T> | null
  }
  let snapshot: BootstrapSnapshot<T> | null = null
  try {
    const serialized = window.localStorage.getItem(storageKey(collection))
    const parsed: unknown = serialized ? JSON.parse(serialized) : null
    if (validSnapshot(parsed) && manifest().collections[collection] === parsed.serverVersion) {
      snapshot = parsed as BootstrapSnapshot<T>
    }
  } catch {}
  memoryCache.set(collection, snapshot)
  return snapshot
}

export function writeDashboardBootstraps(
  collections: Partial<Record<DashboardCollection, Record<string, unknown>[]>>,
  serverVersion: number,
  syncedAt: string,
) {
  if (typeof window === 'undefined') return
  const snapshots = Object.entries(collections) as Array<[DashboardCollection, Record<string, unknown>[]]>
  if (!snapshots.length) return
  const nextManifest: BootstrapManifest = {
    schemaVersion: 3,
    collections: { ...manifest().collections },
  }
  try {
    for (const [collection, values] of snapshots) {
      const snapshot: BootstrapSnapshot = {
        schemaVersion: 3,
        serverVersion,
        syncedAt,
        values,
      }
      window.localStorage.setItem(storageKey(collection), JSON.stringify(snapshot))
      nextManifest.collections[collection] = serverVersion
    }
    window.localStorage.setItem(manifestKey, JSON.stringify(nextManifest))
    memoryManifest = nextManifest
    for (const [collection, values] of snapshots) {
      memoryCache.set(collection, { schemaVersion: 3, serverVersion, syncedAt, values })
    }
  } catch {}
}

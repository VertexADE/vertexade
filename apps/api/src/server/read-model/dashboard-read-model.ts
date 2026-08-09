import { createHash, randomUUID } from 'node:crypto'

const dashboardReadModelCollections = ['repositories', 'pullRequests', 'agentThreads', 'dashboardMeta', 'workItems'] as const

export type DashboardReadModelCollection = (typeof dashboardReadModelCollections)[number]

export type DashboardReadModelEntry = {
  key: string
  value: unknown
  sourceUpdatedAt: string | null
  position: number
}

export type DashboardReadModelSnapshot = Record<DashboardReadModelCollection, DashboardReadModelEntry[]>

export type DashboardReadModelUpdate = {
  version: number
  mode: 'replace' | 'patch'
  entries?: DashboardReadModelEntry[]
  upserts?: DashboardReadModelEntry[]
  deletes?: string[]
}

export type DashboardReadModelChanges = {
  instanceId: string
  version: number
  updates: Partial<Record<DashboardReadModelCollection, DashboardReadModelUpdate>>
}

export type DashboardReadModelStatus = {
  instanceId: string
  version: number
  refreshCount: number
  lastRefreshAt: string | null
  lastRefreshDurationMs: number | null
  lastChangedCollections: DashboardReadModelCollection[]
  lastError: string | null
}

type DashboardReadModelOptions = {
  snapshot(): DashboardReadModelSnapshot
  debounceMs?: number
  instanceId?: string
  now?: () => number
}

type StoredDashboardReadModel = {
  version: number
  entries: DashboardReadModelEntry[]
  patchFromVersion: number
  upserts: DashboardReadModelEntry[]
  deletes: string[]
}

function digest(entries: DashboardReadModelEntry[]) {
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

export class DashboardReadModelStore {
  readonly #hashes = new Map<DashboardReadModelCollection, string>()
  readonly #models = new Map<DashboardReadModelCollection, StoredDashboardReadModel>()
  readonly #debounceMs: number
  readonly #instanceId: string
  readonly #now: () => number
  #version = 0
  #timer: ReturnType<typeof setTimeout> | undefined
  #refreshing: Promise<void> | undefined
  #refreshRequested = false
  #refreshCount = 0
  #lastRefreshAt: string | null = null
  #lastRefreshDurationMs: number | null = null
  #lastChangedCollections: DashboardReadModelCollection[] = []
  #lastError: string | null = null

  constructor(private readonly options: DashboardReadModelOptions) {
    this.#debounceMs = options.debounceMs ?? 80
    this.#instanceId = options.instanceId ?? randomUUID()
    this.#now = options.now ?? Date.now
  }

  schedule() {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.refresh().catch(() => undefined)
    }, this.#debounceMs)
  }

  async refresh() {
    if (this.#refreshing !== undefined) {
      this.#refreshRequested = true
      return this.#refreshing
    }
    this.#refreshing = Promise.resolve().then(() => this.#measureRefresh())
    try {
      await this.#refreshing
    } finally {
      this.#refreshing = undefined
      if (this.#refreshRequested) {
        this.#refreshRequested = false
        this.schedule()
      }
    }
  }

  async changes(since = 0, clientInstanceId?: string): Promise<DashboardReadModelChanges> {
    clearTimeout(this.#timer)
    this.#timer = undefined
    await this.refresh()
    const effectiveSince = clientInstanceId === this.#instanceId && since <= this.#version ? since : 0
    return {
      instanceId: this.#instanceId,
      version: this.#version,
      updates: Object.fromEntries(
        dashboardReadModelCollections.flatMap((collection) => {
          const model = this.#models.get(collection)
          if (!model || model.version <= effectiveSince) return []
          const canPatch = effectiveSince > 0 && effectiveSince >= model.patchFromVersion
          const update: DashboardReadModelUpdate = canPatch
            ? {
                version: model.version,
                mode: 'patch',
                upserts: model.upserts,
                deletes: model.deletes,
              }
            : {
                version: model.version,
                mode: 'replace',
                entries: model.entries,
              }
          return [[collection, update]]
        }),
      ),
    }
  }

  stop() {
    clearTimeout(this.#timer)
    this.#timer = undefined
  }

  status(): DashboardReadModelStatus {
    return {
      instanceId: this.#instanceId,
      version: this.#version,
      refreshCount: this.#refreshCount,
      lastRefreshAt: this.#lastRefreshAt,
      lastRefreshDurationMs: this.#lastRefreshDurationMs,
      lastChangedCollections: this.#lastChangedCollections,
      lastError: this.#lastError,
    }
  }

  #measureRefresh() {
    const startedAt = performance.now()
    this.#refreshCount += 1
    this.#lastRefreshAt = new Date().toISOString()
    try {
      this.#lastChangedCollections = this.#refreshSnapshot()
      this.#lastError = null
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      this.#lastRefreshDurationMs = Math.round((performance.now() - startedAt) * 100) / 100
    }
  }

  #refreshSnapshot() {
    const snapshot = this.options.snapshot()
    const changed = dashboardReadModelCollections.filter((collection) => {
      const nextHash = digest(snapshot[collection])
      if (nextHash === this.#hashes.get(collection)) return false
      this.#hashes.set(collection, nextHash)
      return true
    })
    if (!changed.length) return changed
    this.#version = Math.max(this.#version + 1, this.#now())
    for (const collection of changed) {
      const previous = this.#models.get(collection)
      const entries = snapshot[collection]
      const previousByKey = new Map(previous?.entries.map((entry) => [entry.key, entry]))
      const nextKeys = new Set(entries.map((entry) => entry.key))
      this.#models.set(collection, {
        version: this.#version,
        entries,
        patchFromVersion: previous?.version ?? 0,
        upserts: entries.filter((entry) => {
          const existing = previousByKey.get(entry.key)
          return existing === undefined || JSON.stringify(existing) !== JSON.stringify(entry)
        }),
        deletes: previous?.entries.filter((entry) => !nextKeys.has(entry.key)).map((entry) => entry.key) ?? [],
      })
    }
    return changed
  }
}

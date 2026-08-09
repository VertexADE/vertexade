import type {
  ExtensionCacheInvalidation,
  ExtensionCacheMetadata,
  ExtensionCacheOptions,
  ExtensionCacheResult,
  ExtensionCacheServices,
  ExtensionCacheState,
  ExtensionCacheStats,
} from '@vertexade/platform-contracts'

type Entry = {
  namespace: string
  key: string
  value: unknown
  cachedAt: number
  expiresAt: number
  staleUntil: number
  tags: Set<string>
  accessedAt: number
}

type Counters = Omit<ExtensionCacheStats, 'namespace' | 'entries' | 'lastRefreshAt'> & {
  lastRefreshAt?: string
}

const emptyCounters = (): Counters => ({
  hits: 0,
  misses: 0,
  staleHits: 0,
  refreshes: 0,
  errors: 0,
  evictions: 0,
  coalesced: 0,
})

function requireName(value: string, label: string) {
  const name = String(value || '').trim()
  if (!name || name.length > 240 || /[\u0000-\u001f]/.test(name)) throw new Error(`${label} must contain 1–240 printable characters`)
  return name
}

function policy(options: ExtensionCacheOptions) {
  if (!Number.isFinite(options.ttlMs) || options.ttlMs < 0) throw new Error('Cache ttlMs must be zero or greater')
  const staleWhileRevalidateMs = options.staleWhileRevalidateMs ?? 0
  if (!Number.isFinite(staleWhileRevalidateMs) || staleWhileRevalidateMs < 0)
    throw new Error('Cache staleWhileRevalidateMs must be zero or greater')
  return { ttlMs: options.ttlMs, staleWhileRevalidateMs }
}

function metadata(entry: Entry, state: ExtensionCacheState, refreshing: boolean): ExtensionCacheMetadata {
  return {
    state,
    key: entry.key,
    cachedAt: new Date(entry.cachedAt).toISOString(),
    expiresAt: new Date(entry.expiresAt).toISOString(),
    staleUntil: new Date(entry.staleUntil).toISOString(),
    refreshing,
  }
}

function matchesInvalidation(entry: Entry, key: string, prefix: string, tags: Set<string>) {
  if (key && entry.key !== key) return false
  if (prefix && !entry.key.startsWith(prefix)) return false
  return !tags.size || [...tags].some((tag) => entry.tags.has(tag))
}

function freshEntry(entry: Entry | undefined, now: number, forceRefresh: boolean | undefined) {
  return !forceRefresh && entry !== undefined && now < entry.expiresAt ? entry : undefined
}

function staleEntry(entry: Entry | undefined, now: number, forceRefresh: boolean | undefined) {
  return !forceRefresh && entry !== undefined && now >= entry.expiresAt && now < entry.staleUntil ? entry : undefined
}

function refreshState(entry: Entry | undefined, forceRefresh: boolean | undefined): ExtensionCacheState {
  return entry || forceRefresh ? 'refreshed' : 'miss'
}

function normalizedInvalidation(input: ExtensionCacheInvalidation) {
  return {
    key: input.key ? requireName(input.key, 'Cache key') : '',
    prefix: input.prefix ? requireName(input.prefix, 'Cache prefix') : '',
    tags: new Set((input.tags || []).map((tag) => requireName(tag, 'Cache tag'))),
  }
}

export class ExtensionCacheStore implements ExtensionCacheServices {
  readonly #entries = new Map<string, Entry>()
  readonly #inFlight = new Map<string, Promise<Entry>>()
  readonly #counters = new Map<string, Counters>()
  readonly #generations = new Map<string, number>()

  constructor(
    private readonly maxEntries = 1_000,
    private readonly onChange?: (namespace: string) => void,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('Cache maxEntries must be a positive integer')
  }

  scope(namespace: string): ExtensionCacheServices {
    const name = requireName(namespace, 'Cache namespace')
    return {
      getOrLoad: (key, loader, options) => this.#getOrLoad(name, key, loader, options),
      invalidate: (input) => this.invalidateNamespace(name, input),
      stats: () => this.statsFor(name),
    }
  }

  getOrLoad<T>(key: string, loader: () => Promise<T>, options: ExtensionCacheOptions) {
    return this.#getOrLoad('core', key, loader, options)
  }

  invalidate(input?: ExtensionCacheInvalidation) {
    return this.invalidateNamespace('core', input)
  }

  stats() {
    return this.statsFor('core')
  }

  statsFor(namespace: string): ExtensionCacheStats {
    const counters = this.#counters.get(namespace) || emptyCounters()
    const entries = [...this.#entries.values()].filter((entry) => entry.namespace === namespace).length
    return { namespace, entries, ...counters }
  }

  allStats() {
    const namespaces = new Set([...this.#counters.keys(), ...[...this.#entries.values()].map((entry) => entry.namespace)])
    return [...namespaces].sort().map((namespace) => this.statsFor(namespace))
  }

  invalidateNamespace(namespace: string, input: ExtensionCacheInvalidation = {}) {
    const { key, prefix, tags } = normalizedInvalidation(input)
    this.#generations.set(namespace, (this.#generations.get(namespace) || 0) + 1)
    const matches = [...this.#entries.entries()].filter(
      ([, entry]) => entry.namespace === namespace && matchesInvalidation(entry, key, prefix, tags),
    )
    for (const [qualified] of matches) this.#entries.delete(qualified)
    const removed = matches.length
    if (removed) this.onChange?.(namespace)
    return removed
  }

  async #getOrLoad<T>(
    namespace: string,
    rawKey: string,
    loader: () => Promise<T>,
    options: ExtensionCacheOptions,
  ): Promise<ExtensionCacheResult<T>> {
    const key = requireName(rawKey, 'Cache key')
    policy(options)
    for (const tag of options.tags || []) requireName(tag, 'Cache tag')
    const qualified = `${namespace}\u0000${key}`
    const now = Date.now()
    const entry = this.#entries.get(qualified)
    const counters = this.#counter(namespace)
    const fresh = freshEntry(entry, now, options.forceRefresh)
    if (fresh) {
      counters.hits += 1
      fresh.accessedAt = now
      return { value: fresh.value as T, cache: metadata(fresh, 'fresh', false) }
    }
    const stale = staleEntry(entry, now, options.forceRefresh)
    if (stale) {
      counters.staleHits += 1
      stale.accessedAt = now
      const refreshing = this.#refresh(namespace, key, loader, options, stale).catch(() => undefined)
      void refreshing
      return { value: stale.value as T, cache: metadata(stale, 'stale', true) }
    }
    if (entry) this.#entries.delete(qualified)
    const state = refreshState(entry, options.forceRefresh)
    if (state === 'miss') counters.misses += 1
    const refreshed = await this.#refresh(namespace, key, loader, options, entry)
    return { value: refreshed.value as T, cache: metadata(refreshed, state, false) }
  }

  #refresh<T>(namespace: string, key: string, loader: () => Promise<T>, options: ExtensionCacheOptions, previous?: Entry) {
    const qualified = `${namespace}\u0000${key}`
    const existing = this.#inFlight.get(qualified)
    if (existing !== undefined) {
      this.#counter(namespace).coalesced += 1
      return existing
    }
    const { ttlMs, staleWhileRevalidateMs } = policy(options)
    const generation = this.#generations.get(namespace) || 0
    const refresh = Promise.resolve()
      .then(loader)
      .then((value) => {
        const now = Date.now()
        const entry: Entry = {
          namespace,
          key,
          value,
          cachedAt: now,
          expiresAt: now + ttlMs,
          staleUntil: now + ttlMs + staleWhileRevalidateMs,
          tags: new Set((options.tags || []).map((tag) => requireName(tag, 'Cache tag'))),
          accessedAt: now,
        }
        if ((this.#generations.get(namespace) || 0) === generation) this.#entries.set(qualified, entry)
        const counters = this.#counter(namespace)
        counters.refreshes += 1
        counters.lastRefreshAt = new Date(now).toISOString()
        this.#evict()
        this.onChange?.(namespace)
        return entry
      })
      .catch((error) => {
        this.#counter(namespace).errors += 1
        if (previous && (this.#generations.get(namespace) || 0) === generation) this.#entries.set(qualified, previous)
        throw error
      })
      .finally(() => this.#inFlight.delete(qualified))
    this.#inFlight.set(qualified, refresh)
    return refresh
  }

  #counter(namespace: string) {
    const value = this.#counters.get(namespace) || emptyCounters()
    this.#counters.set(namespace, value)
    return value
  }

  #evict() {
    while (this.#entries.size > this.maxEntries) {
      const oldest = [...this.#entries.entries()].sort((left, right) => left[1].accessedAt - right[1].accessedAt)[0]
      if (!oldest) return
      this.#entries.delete(oldest[0])
      this.#counter(oldest[1].namespace).evictions += 1
    }
  }
}

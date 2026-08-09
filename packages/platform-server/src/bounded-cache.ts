export type BoundedTtlCacheOptions<V> = {
  maxEntries: number
  maxBytes: number
  ttlMs: number
  sizeOf(value: V): number
  slidingTtl?: boolean
  now?: () => number
}

type CacheEntry<V> = {
  value: V
  bytes: number
  expiresAt: number
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`)
  return value
}

function retainedBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Cache entry size must be a non-negative finite number')
  return Math.ceil(value)
}

export function jsonByteSize(value: unknown) {
  const json = JSON.stringify(value)
  return json === undefined ? 0 : Buffer.byteLength(json)
}

export class BoundedTtlCache<K, V> {
  readonly #entries = new Map<K, CacheEntry<V>>()
  readonly #maxEntries: number
  readonly #maxBytes: number
  readonly #ttlMs: number
  readonly #sizeOf: (value: V) => number
  readonly #slidingTtl: boolean
  readonly #now: () => number
  #retainedBytes = 0

  constructor(options: BoundedTtlCacheOptions<V>) {
    this.#maxEntries = positiveInteger(options.maxEntries, 'Cache maxEntries')
    this.#maxBytes = positiveInteger(options.maxBytes, 'Cache maxBytes')
    this.#ttlMs = positiveInteger(options.ttlMs, 'Cache ttlMs')
    this.#sizeOf = options.sizeOf
    this.#slidingTtl = options.slidingTtl ?? false
    this.#now = options.now ?? Date.now
  }

  get size() {
    this.#removeExpired(this.#now())
    return this.#entries.size
  }

  get retainedBytes() {
    this.#removeExpired(this.#now())
    return this.#retainedBytes
  }

  get(key: K): V | undefined {
    const now = this.#now()
    const entry = this.#entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= now) {
      this.delete(key)
      return undefined
    }
    this.#entries.delete(key)
    if (this.#slidingTtl) entry.expiresAt = now + this.#ttlMs
    this.#entries.set(key, entry)
    return entry.value
  }

  set(key: K, value: V) {
    const now = this.#now()
    this.#removeExpired(now)
    const bytes = retainedBytes(this.#sizeOf(value))
    this.delete(key)
    if (bytes > this.#maxBytes) return false
    this.#entries.set(key, { value, bytes, expiresAt: now + this.#ttlMs })
    this.#retainedBytes += bytes
    this.#evict()
    return this.#entries.has(key)
  }

  delete(key: K) {
    const entry = this.#entries.get(key)
    if (!entry) return false
    this.#entries.delete(key)
    this.#retainedBytes -= entry.bytes
    return true
  }

  clear() {
    this.#entries.clear()
    this.#retainedBytes = 0
  }

  *keys(): IterableIterator<K> {
    this.#removeExpired(this.#now())
    yield* [...this.#entries.keys()]
  }

  #removeExpired(now: number) {
    for (const [key, entry] of this.#entries) if (entry.expiresAt <= now) this.delete(key)
  }

  #evict() {
    while (this.#entries.size > this.#maxEntries || this.#retainedBytes > this.#maxBytes) {
      const oldest = this.#entries.keys().next()
      if (oldest.done) break
      this.delete(oldest.value)
    }
  }
}

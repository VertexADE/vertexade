import { describe, expect, it } from 'vite-plus/test'
import { BoundedTtlCache } from './bounded-cache.ts'

function cache(options: { entries?: number; bytes?: number; ttl?: number; now?: () => number; sliding?: boolean } = {}) {
  return new BoundedTtlCache<string, string>({
    maxEntries: options.entries ?? 3,
    maxBytes: options.bytes ?? 10,
    ttlMs: options.ttl ?? 100,
    sizeOf: (value) => Buffer.byteLength(value),
    ...(options.sliding === undefined ? {} : { slidingTtl: options.sliding }),
    ...(options.now ? { now: options.now } : {}),
  })
}

describe('bounded TTL cache', () => {
  it('evicts the least recently used entry at its entry limit', () => {
    const values = cache({ entries: 2 })
    values.set('one', '1')
    values.set('two', '2')
    expect(values.get('one')).toBe('1')
    values.set('three', '3')

    expect([...values.keys()]).toEqual(['one', 'three'])
    expect(values.get('two')).toBeUndefined()
  })

  it('evicts entries until the total byte budget is satisfied', () => {
    const values = cache({ bytes: 5 })
    values.set('one', 'abc')
    values.set('two', 'def')

    expect([...values.keys()]).toEqual(['two'])
    expect(values.retainedBytes).toBe(3)
  })

  it('reaccounts replacements and rejects a single oversized entry', () => {
    const values = cache({ bytes: 5 })
    values.set('one', '1234')
    values.set('one', '1')

    expect(values.retainedBytes).toBe(1)
    expect(values.set('large', '123456')).toBe(false)
    expect(values.get('large')).toBeUndefined()
    expect(values.retainedBytes).toBe(1)
  })

  it('removes expired entries eagerly and supports a sliding TTL', () => {
    let now = 0
    const values = cache({ ttl: 10, now: () => now, sliding: true })
    values.set('active', '1')
    now = 9
    expect(values.get('active')).toBe('1')
    now = 18
    expect(values.get('active')).toBe('1')
    now = 29
    expect(values.get('active')).toBeUndefined()
    expect(values.size).toBe(0)
  })

  it('keeps large unique workloads inside both budgets', () => {
    const values = cache({ entries: 20, bytes: 200 })
    for (let index = 0; index < 500; index += 1) values.set(`pr-${index}`, 'x'.repeat(10))

    expect(values.size).toBeLessThanOrEqual(20)
    expect(values.retainedBytes).toBeLessThanOrEqual(200)
  })
})

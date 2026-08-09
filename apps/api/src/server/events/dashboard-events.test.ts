import { afterEach, describe, expect, it } from 'vite-plus/test'
import { configuredDashboardEventLimits, DashboardEvents } from './dashboard-events.ts'

const events: DashboardEvents[] = []
afterEach(() => {
  for (const eventBus of events.splice(0)) eventBus.dispose()
})

describe('dashboard events', () => {
  it('streams the connection event and later changes', async () => {
    const eventBus = new DashboardEvents()
    events.push(eventBus)
    const abort = new AbortController()
    const response = eventBus.stream({ signal: abort.signal, identity: '127.0.0.1' })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    const connected = decoder.decode((await reader.read()).value)
    expect(connected).toContain('"reason":"connected"')
    expect(connected).toContain('"resync":true')
    eventBus.emit('work_updated', 42)
    const changed = decoder.decode((await reader.read()).value)
    expect(changed).toContain('"reason":"work_updated"')
    expect(changed).toContain('"job_id":42')
    expect(changed).toContain('"topic":"work"')
    expect(changed).toContain('"entity_kind":"work-item"')
    expect(changed).toContain('"operation":"updated"')
    expect(changed).toMatch(/id: \d+/)
    abort.abort()
    expect(eventBus.stats().connected).toBe(0)
  })

  it('enforces per-identity and global connection limits with capacity recovery', async () => {
    const eventBus = new DashboardEvents({ maxClients: 2, maxClientsPerIdentity: 1 })
    events.push(eventBus)
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()
    const first = eventBus.stream({ signal: firstAbort.signal, identity: 'client-a' })
    const duplicate = eventBus.stream({ signal: new AbortController().signal, identity: 'client-a' })
    const second = eventBus.stream({ signal: secondAbort.signal, identity: 'client-b' })
    const overflow = eventBus.stream({ signal: new AbortController().signal, identity: 'client-c' })
    expect([first.status, duplicate.status, second.status, overflow.status]).toEqual([200, 429, 200, 429])
    expect(duplicate.headers.get('retry-after')).toBe('5')
    expect(eventBus.stats()).toMatchObject({ connected: 2, rejected: 2 })
    firstAbort.abort()
    expect(eventBus.stats().connected).toBe(1)
    expect(eventBus.stream({ signal: new AbortController().signal, identity: 'client-c' }).status).toBe(200)
    secondAbort.abort()
  })

  it('disconnects a non-reading client before its byte queue can exceed the limit', async () => {
    const eventBus = new DashboardEvents({ maxQueuedBytes: 512, maxEventBytes: 1024 })
    events.push(eventBus)
    const response = eventBus.stream({ signal: new AbortController().signal, identity: 'slow-client' })
    expect(response.status).toBe(200)
    eventBus.emit(`work_${'x'.repeat(500)}`, 42)
    expect(eventBus.stats()).toMatchObject({ connected: 0, slow_disconnected: 1 })
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('connected')
    expect((await reader.read()).done).toBe(true)
  })

  it('closes all stream controllers during disposal', async () => {
    const eventBus = new DashboardEvents()
    events.push(eventBus)
    const response = eventBus.stream({ signal: new AbortController().signal, identity: 'client' })
    const reader = response.body!.getReader()
    await reader.read()
    eventBus.dispose()
    expect((await reader.read()).done).toBe(true)
    expect(eventBus.stats().connected).toBe(0)
  })

  it('rejects invalid environment limits instead of disabling a bound', () => {
    expect(() => configuredDashboardEventLimits({ VERTEXADE_SSE_MAX_CONNECTIONS: '0' })).toThrow('integer from 1')
    expect(() =>
      configuredDashboardEventLimits({
        VERTEXADE_SSE_MAX_CONNECTIONS: '2',
        VERTEXADE_SSE_MAX_CONNECTIONS_PER_IP: '3',
      }),
    ).toThrow('must not exceed')
    expect(() =>
      configuredDashboardEventLimits({
        VERTEXADE_SSE_MAX_QUEUE_BYTES: '4096',
        VERTEXADE_SSE_MAX_EVENT_BYTES: '8192',
      }),
    ).toThrow('must not exceed')
  })
})

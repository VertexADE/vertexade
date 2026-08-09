import { Subject } from 'rxjs'
import { describe, expect, it, vi } from 'vite-plus/test'
import { createPlatformEventStream, createReactiveQuery, parsePlatformEvent } from './reactive.ts'

class FakeEventSource {
  readonly listeners = new Map<string, Array<(event: Event) => void>>()
  closed = false

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener])
  }

  emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) || []) listener(event)
  }

  close() {
    this.closed = true
  }
}

describe('platform reactive client', () => {
  it('parses typed event envelopes while preserving compatibility fields', () => {
    expect(
      parsePlatformEvent(
        new MessageEvent('change', {
          data: JSON.stringify({
            sequence: 42,
            reason: 'work_updated',
            topic: 'work',
            entity_kind: 'work-item',
            entity_id: 7,
            job_id: 7,
            operation: 'updated',
            time: '2026-07-28T00:00:00.000Z',
          }),
        }),
      ),
    ).toEqual({
      sequence: 42,
      reason: 'work_updated',
      topic: 'work',
      entityKind: 'work-item',
      entityId: 7,
      jobId: 7,
      operation: 'updated',
      time: '2026-07-28T00:00:00.000Z',
    })
  })

  it('shares parsed events and connection state from one transport', () => {
    const source = new FakeEventSource()
    const stream = createPlatformEventStream({ createEventSource: () => source })
    const events: string[] = []
    const connections: boolean[] = []
    stream.events$.subscribe(({ data }) => events.push(data.reason))
    stream.connection$.subscribe((state) => connections.push(state.connected))

    source.emit(
      'change',
      new MessageEvent('change', {
        data: JSON.stringify({ sequence: 1, reason: 'connected', resync: true }),
      }),
    )
    source.emit(
      'change',
      new MessageEvent('change', {
        data: JSON.stringify({ sequence: 2, reason: 'job_finished', job_id: 9 }),
      }),
    )
    source.emit('error', new Event('error'))
    stream.close()

    expect(events).toEqual(['connected', 'job_finished'])
    expect(connections).toEqual([false, true, true, false, false])
    expect(source.closed).toBe(true)
  })

  it('coalesces query invalidations and keeps the last good value after a failed refresh', async () => {
    vi.useFakeTimers()
    const invalidations = new Subject<string>()
    const load = vi.fn().mockResolvedValueOnce({ value: 1 }).mockRejectedValueOnce(new Error('offline'))
    const query = createReactiveQuery({
      load,
      invalidations$: invalidations,
      accepts: (reason) => reason === 'changed',
      auditMs: 50,
    })

    await vi.runAllTimersAsync()
    expect(query.snapshot.data).toEqual({ value: 1 })
    invalidations.next('ignored')
    invalidations.next('changed')
    invalidations.next('changed')
    await vi.runAllTimersAsync()

    expect(load).toHaveBeenCalledTimes(2)
    expect(query.snapshot.data).toEqual({ value: 1 })
    expect(query.snapshot.error?.message).toBe('offline')
    query.dispose()
    vi.useRealTimers()
  })
})

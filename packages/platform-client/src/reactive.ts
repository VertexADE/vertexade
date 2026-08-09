import { auditTime, BehaviorSubject, filter, type Observable, Subject, type Subscription } from 'rxjs'

export type PlatformEvent = {
  sequence: number
  reason: string
  topic: string
  entityKind: string | null
  entityId: number | null
  jobId: number | null
  operation: string
  time: string
  resync?: boolean
}

export type PlatformEventMessage = {
  data: PlatformEvent
  raw: Event
}

export type PlatformConnectionState = {
  connected: boolean
  lastEventAt: string | null
  lastSequence: number
  error: string | null
}

export type PlatformEventSource = {
  addEventListener(type: string, listener: (event: Event) => void): void
  close(): void
}

export type PlatformEventStreamOptions = {
  url?: string
  createEventSource?: (url: string) => PlatformEventSource
}

export type ReactiveQueryState<T> = {
  data: T | undefined
  loading: boolean
  error: Error | null
  updatedAt: string | null
}

export type ReactiveQueryOptions<T, TInvalidation = unknown> = {
  load(): Promise<T>
  invalidations$?: Observable<TInvalidation>
  accepts?: (invalidation: TInvalidation) => boolean
  auditMs?: number
  autoStart?: boolean
}

const initialConnectionState: PlatformConnectionState = {
  connected: false,
  lastEventAt: null,
  lastSequence: 0,
  error: null,
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function integer(value: unknown) {
  return Number.isInteger(value) ? Number(value) : null
}

export function parsePlatformEvent(event: Event): PlatformEvent | null {
  try {
    const parsed = JSON.parse(String((event as MessageEvent).data || '')) as Record<string, unknown>
    const reason = text(parsed.reason)
    if (!reason) return null
    return {
      sequence: integer(parsed.sequence) ?? 0,
      reason,
      topic: text(parsed.topic) || 'platform',
      entityKind: text(parsed.entity_kind) || null,
      entityId: integer(parsed.entity_id),
      jobId: integer(parsed.job_id),
      operation: text(parsed.operation) || 'changed',
      time: text(parsed.time) || new Date().toISOString(),
      ...(parsed.resync === true ? { resync: true } : {}),
    }
  } catch {
    return null
  }
}

export function createPlatformEventStream(options: PlatformEventStreamOptions = {}) {
  const eventsSubject = new Subject<PlatformEventMessage>()
  const connectionSubject = new BehaviorSubject<PlatformConnectionState>(initialConnectionState)
  const url = options.url || '/api/events'
  const source = (options.createEventSource || ((target) => new EventSource(target)))(url)

  source.addEventListener('change', (raw) => {
    const data = parsePlatformEvent(raw)
    if (!data) return
    connectionSubject.next({
      connected: true,
      lastEventAt: data.time,
      lastSequence: Math.max(connectionSubject.value.lastSequence, data.sequence),
      error: null,
    })
    eventsSubject.next({ data, raw })
  })
  source.addEventListener('error', () => {
    connectionSubject.next({
      ...connectionSubject.value,
      connected: false,
      error: 'Platform event stream disconnected',
    })
  })

  return {
    events$: eventsSubject.asObservable(),
    connection$: connectionSubject.asObservable(),
    close() {
      source.close()
      eventsSubject.complete()
      connectionSubject.next({ ...connectionSubject.value, connected: false })
      connectionSubject.complete()
    },
  }
}

export function createReactiveQuery<T, TInvalidation = unknown>(options: ReactiveQueryOptions<T, TInvalidation>) {
  const stateSubject = new BehaviorSubject<ReactiveQueryState<T>>({
    data: undefined,
    loading: false,
    error: null,
    updatedAt: null,
  })
  let active = true
  let loading: Promise<void> | undefined
  let refreshRequested = false
  let invalidationSubscription: Subscription | undefined

  async function loadOnce() {
    stateSubject.next({ ...stateSubject.value, loading: true, error: null })
    try {
      const data = await options.load()
      if (!active) return
      stateSubject.next({
        data,
        loading: false,
        error: null,
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      if (!active) return
      stateSubject.next({
        ...stateSubject.value,
        loading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  function refresh() {
    refreshRequested = true
    if (loading !== undefined) return loading
    loading = (async () => {
      while (active && refreshRequested) {
        refreshRequested = false
        await loadOnce()
      }
    })().finally(() => {
      loading = undefined
    })
    return loading
  }

  if (options.invalidations$) {
    invalidationSubscription = options.invalidations$
      .pipe(
        filter((value) => options.accepts?.(value) ?? true),
        auditTime(options.auditMs ?? 120),
      )
      .subscribe(() => void refresh())
  }
  if (options.autoStart !== false) queueMicrotask(() => void refresh())

  return {
    state$: stateSubject.asObservable(),
    get snapshot() {
      return stateSubject.value
    },
    refresh,
    dispose() {
      active = false
      invalidationSubscription?.unsubscribe()
      stateSubject.complete()
    },
  }
}

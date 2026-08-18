import { createPlatformClient, type ApiClient } from '@vertexade/platform-client'
import { parsePlatformEvent, type PlatformConnectionState, type PlatformEventMessage } from '@vertexade/platform-client/reactive'
import { auditTime, BehaviorSubject, filter, Subject } from 'rxjs'
import { backendApiPath, loadBackendRegistry, namespaceBackendId, type BackendDescriptor } from './backend-registry'
import { agentLaunchOptions } from './agent-launch-store'
import { browserPairedServersRequestHeaders, browserPairedServersStorageKey } from './browser-paired-servers'

export type { ApiClient } from '@vertexade/platform-client'
export { isPlatformApiError } from '@vertexade/platform-client'
export type { PlatformEvent, PlatformEventMessage } from '@vertexade/platform-client/reactive'
export {
  agentLaunchOptions,
  agentLaunchOptionsStore,
  saveAgentLaunchOptions,
  useAgentLaunchOptions,
  type AgentLaunchOptions,
} from './agent-launch-store'

function platformRequestHeaders(backendId = '') {
  const agent = agentLaunchOptions()
  return {
    ...browserPairedServersRequestHeaders(),
    ...(backendId ? { 'x-vertexade-backend': backendId } : {}),
    ...(agent.agentId ? { 'x-agent-provider': agent.agentId } : {}),
    ...(agent.model ? { 'x-agent-model': agent.model } : {}),
    ...(agent.reasoningEffort ? { 'x-agent-reasoning-effort': agent.reasoningEffort } : {}),
    ...(agent.agentId === 'codex' && agent.serviceTier ? { 'x-agent-service-tier': agent.serviceTier } : {}),
    'x-agent-subagents': agent.allowSubagents ? 'true' : 'false',
  }
}

export const platformClient = createPlatformClient({ headers: () => platformRequestHeaders() })
const backendPlatformClients = new Map<string, ReturnType<typeof createPlatformClient>>()

export function platformClientForBackend(backendId?: string | null) {
  if (!backendId) return platformClient
  const current = backendPlatformClients.get(backendId)
  if (current) return current
  const client = createPlatformClient({ headers: () => platformRequestHeaders(backendId) })
  backendPlatformClients.set(backendId, client)
  return client
}

const initialConnection: PlatformConnectionState = {
  connected: false,
  lastEventAt: null,
  lastSequence: 0,
  error: null,
}

const backendState = new BehaviorSubject<BackendDescriptor[]>([])
let eventStream: ReturnType<typeof createFederatedEventStream> | undefined

function namespacedEvent(raw: Event, backend: BackendDescriptor) {
  if (!backend.namespace) return raw
  try {
    const payload = JSON.parse(String((raw as MessageEvent).data || '')) as Record<string, unknown>
    for (const field of ['entity_id', 'job_id']) {
      if (payload[field] != null) payload[field] = namespaceBackendId(payload[field], backend.namespace)
    }
    payload.backend_id = backend.id
    payload.backend_name = backend.label
    return new MessageEvent('change', { data: JSON.stringify(payload) })
  } catch {
    return raw
  }
}

function createFederatedEventStream() {
  const events = new Subject<PlatformEventMessage>()
  const connection = new BehaviorSubject<PlatformConnectionState>(initialConnection)
  const sources: AbortController[] = []
  let closed = false
  let generation = 0

  const setBackendConnected = (id: string, connected: boolean, error: string | null = null) => {
    const next = backendState.value.map((backend) =>
      backend.id === id
        ? {
            ...backend,
            connected,
            error,
            ...(connected ? { lastConnectedAt: new Date().toISOString() } : {}),
          }
        : backend,
    )
    backendState.next(next)
    connection.next({
      ...connection.value,
      connected: next.some((backend) => backend.connected),
      error: next.length && next.every((backend) => !backend.connected) ? 'All platform event streams are disconnected' : null,
    })
  }

  const receive = (raw: Event, currentBackend: BackendDescriptor) => {
    setBackendConnected(currentBackend.id, true)
    const event = namespacedEvent(raw, currentBackend)
    const data = parsePlatformEvent(event)
    if (!data) return
    connection.next({
      connected: true,
      lastEventAt: data.time,
      lastSequence: Math.max(connection.value.lastSequence, data.sequence),
      error: null,
    })
    events.next({ data, raw: event })
  }

  const openSource = (url: string, backend: () => BackendDescriptor, currentGeneration: number) => {
    const controller = new AbortController()
    sources.push(controller)
    void reconnectingEventStream(
      url,
      controller.signal,
      (raw) => {
        if (currentGeneration === generation) receive(raw, backend())
      },
      (error) => {
        if (currentGeneration === generation) setBackendConnected(backend().id, false, error)
      },
      () => {
        if (currentGeneration === generation) setBackendConnected(backend().id, true)
      },
    )
  }

  const reloadBackends = async () => {
    const currentGeneration = ++generation
    sources.splice(0).forEach((source) => source.abort())
    try {
      const { backends } = await loadBackendRegistry()
      if (closed || currentGeneration !== generation) return
      backendState.next(backends)
      connection.next({ ...connection.value, connected: backends.some((backend) => backend.connected) })
      for (const backend of backends.filter((candidate) => candidate.realtime !== false))
        openSource(backend.isDefault ? '/api/events' : `${backend.apiPath}/events`, () => backend, currentGeneration)
    } catch (error) {
      if (closed || currentGeneration !== generation) return
      connection.next({ ...connection.value, connected: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const pairingChanged = () => void reloadBackends()
  const pairingStorageChanged = (event: StorageEvent) => {
    if (event.key === browserPairedServersStorageKey) void reloadBackends()
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('vertexade:paired-servers', pairingChanged)
    window.addEventListener('storage', pairingStorageChanged)
  }
  void reloadBackends()

  return {
    events$: events.asObservable(),
    connection$: connection.asObservable(),
    close() {
      closed = true
      generation += 1
      sources.forEach((source) => source.abort())
      if (typeof window !== 'undefined') {
        window.removeEventListener('vertexade:paired-servers', pairingChanged)
        window.removeEventListener('storage', pairingStorageChanged)
      }
      events.complete()
      connection.next({ ...connection.value, connected: false })
      connection.complete()
    },
  }
}

async function reconnectingEventStream(
  url: string,
  signal: AbortSignal,
  receive: (event: Event) => void,
  disconnected: (error: string) => void,
  connected: () => void,
) {
  let attempt = 0
  while (!signal.aborted) {
    try {
      await streamEvents(url, signal, receive, () => {
        attempt = 0
        connected()
      })
      if (!signal.aborted) disconnected('Realtime connection ended')
    } catch (error) {
      if (signal.aborted) return
      disconnected(error instanceof Error ? error.message : 'Realtime connection lost')
    }
    attempt += 1
    await abortableDelay(Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5)), signal)
  }
}

function abortableDelay(duration: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, duration)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        resolve()
      },
      { once: true },
    )
  })
}

async function streamEvents(url: string, signal: AbortSignal, receive: (event: Event) => void, connected: () => void) {
  const response = await fetch(url, {
    headers: { accept: 'text/event-stream', ...browserPairedServersRequestHeaders() },
    signal,
  })
  if (!response.ok) throw new Error(`Realtime connection failed with HTTP ${response.status}`)
  if (!response.body) throw new Error('Realtime connection returned no stream')
  connected()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (!signal.aborted) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() || ''
    for (const frame of frames) {
      const lines = frame.split(/\r?\n/)
      const eventName =
        lines
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim() || 'message'
      const data = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (eventName === 'change' && data) receive(new MessageEvent('change', { data }))
    }
    if (done) break
  }
}

function sharedEventStream() {
  eventStream ??= createFederatedEventStream()
  return eventStream
}

export function platformEventMessages() {
  return sharedEventStream().events$
}

export function platformConnectionState() {
  return sharedEventStream().connection$
}

export function platformBackendState() {
  sharedEventStream()
  return backendState.asObservable()
}

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  return platformClient.request<T>(url, options)
}

export async function backendApi<T>(backendId: string | null | undefined, url: string, options: RequestInit = {}): Promise<T> {
  return api<T>(backendApiPath(url, backendId), options)
}

export type FederationFailure = { backendId: string; backendName: string; error: string }
export type FederatedResult = { federation?: { connected: number; total: number; failures: FederationFailure[] } }

export function federationFailureMessage(value: FederatedResult, action: string) {
  const failures = value.federation?.failures || []
  if (!failures.length) return ''
  const servers = failures.map((failure) => failure.backendName).join(', ')
  return `${action} succeeded on ${value.federation!.connected}/${value.federation!.total} servers; failed on ${servers}`
}

export function createScopedApi(request: (path: string, init?: RequestInit) => Promise<Response>): ApiClient {
  return createPlatformClient({ fetch: request }).request
}

export function eventReason(event: Event) {
  try {
    return String(JSON.parse((event as MessageEvent).data).reason || '')
  } catch {
    return ''
  }
}

export function eventEntityId(event: Event) {
  try {
    const value = JSON.parse((event as MessageEvent).data).job_id
    return Number.isInteger(value) ? Number(value) : null
  } catch {
    return null
  }
}

export function isNotificationEvent(event: Event) {
  return eventReason(event).startsWith('notification')
}

export function isModuleCatalogEvent(event: Event) {
  const reason = eventReason(event)
  return reason === 'extensions_updated' || reason === 'extension_cache_updated' || reason === 'extension_cache_invalidated'
}

// Keep the overview live for state changes without reloading it for high-volume
// activity such as agent messages and diff snapshots.
const workBoardEventPrefixes = ['work_', 'job_', 'thread_', 'input_']
const workBoardEvents = new Set(['repository', 'task_linked', 'pr_approved'])

export function isWorkBoardEvent(event: Event) {
  const reason = eventReason(event)
  return workBoardEvents.has(reason) || workBoardEventPrefixes.some((prefix) => reason.startsWith(prefix))
}

export function isThreadEvent(event: Event, jobId: number) {
  return eventEntityId(event) === jobId
}

export function subscribeToDashboardEvents(listener: () => void, accepts: (event: Event) => boolean = () => true) {
  const subscription = platformEventMessages()
    .pipe(
      filter((message: PlatformEventMessage) => accepts(message.raw)),
      auditTime(120),
    )
    .subscribe(listener)
  return () => subscription.unsubscribe()
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

export function dateValue(value: string | number | Date | null | undefined) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const text = String(value)
  const numeric = typeof value === 'number' ? value : /^\d+(?:\.\d+)?$/.test(text.trim()) ? Number(value) : null
  const date =
    numeric === null ? new Date(text.includes('T') ? text : `${text}Z`) : new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
  return Number.isNaN(date.getTime()) ? null : date
}

export function age(value: string | null | undefined) {
  const date = dateValue(value)
  if (!date) return ''
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function duration(startValue: string, endValue?: string | null) {
  const start = dateValue(startValue)
  const end = dateValue(endValue) || new Date()
  if (!start) return ''
  const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

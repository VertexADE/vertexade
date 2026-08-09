import { createPlatformClient, type ApiClient } from '@vertexade/platform-client'
import { parsePlatformEvent, type PlatformConnectionState, type PlatformEventMessage } from '@vertexade/platform-client/reactive'
import { BehaviorSubject, debounceTime, filter, Subject } from 'rxjs'
import { backendApiPath, loadBackendRegistry, namespaceBackendId, type BackendDescriptor } from './backend-registry'

export type { ApiClient } from '@vertexade/platform-client'
export type { PlatformEvent, PlatformEventMessage } from '@vertexade/platform-client/reactive'

export const platformClient = createPlatformClient({
  headers: () => {
    const agent = agentLaunchOptions()
    return {
      ...(agent.agentId ? { 'x-agent-provider': agent.agentId } : {}),
      ...(agent.model ? { 'x-agent-model': agent.model } : {}),
      ...(agent.reasoningEffort ? { 'x-agent-reasoning-effort': agent.reasoningEffort } : {}),
      ...(agent.agentId === 'codex' && agent.serviceTier ? { 'x-agent-service-tier': agent.serviceTier } : {}),
      'x-agent-subagents': agent.allowSubagents ? 'true' : 'false',
    }
  },
})

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
  const sources: EventSource[] = []
  let primaryBackend: BackendDescriptor = {
    id: 'primary',
    label: 'Primary',
    namespace: 0,
    isDefault: true,
    connected: false,
    lastConnectedAt: null,
    error: null,
    apiPath: '/api',
  }

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

  const openSource = (url: string, backend: () => BackendDescriptor) => {
    const source = new EventSource(url)
    sources.push(source)
    source.addEventListener('open', () => setBackendConnected(backend().id, true))
    source.addEventListener('change', (raw) => {
      const currentBackend = backend()
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
    })
    source.addEventListener('error', () => setBackendConnected(backend().id, false, 'Realtime connection lost'))
  }

  openSource('/api/events', () => primaryBackend)

  void loadBackendRegistry()
    .then(({ backends }) => {
      primaryBackend = backends.find((backend) => backend.isDefault) || backends[0] || primaryBackend
      backendState.next(backends)
      connection.next({ ...connection.value, connected: backends.some((backend) => backend.connected) })
      for (const backend of backends.filter((candidate) => !candidate.isDefault)) {
        openSource(`${backend.apiPath}/events`, () => backend)
      }
    })
    .catch((error) => {
      connection.next({ ...connection.value, connected: false, error: error instanceof Error ? error.message : String(error) })
    })

  return {
    events$: events.asObservable(),
    connection$: connection.asObservable(),
    close() {
      sources.forEach((source) => source.close())
      events.complete()
      connection.next({ ...connection.value, connected: false })
      connection.complete()
    },
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

export function createScopedApi(request: (path: string, init?: RequestInit) => Promise<Response>): ApiClient {
  return createPlatformClient({ fetch: request }).request
}

export type AgentLaunchOptions = {
  agentId: string
  model: string
  reasoningEffort: string
  serviceTier?: string
  allowSubagents: boolean
}
export const AGENT_OPTIONS_EVENT = 'agent-launch-options-changed'
const AGENT_OPTIONS_STORAGE_KEY = 'agent-launch-options'
type AgentModelOptions = Omit<AgentLaunchOptions, 'agentId'>
type StoredAgentLaunchOptions = {
  version: 4
  agentId: string
  byAgent: Record<string, AgentModelOptions>
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function storedAgentLaunchOptions(): StoredAgentLaunchOptions {
  const empty: StoredAgentLaunchOptions = { version: 4, agentId: '', byAgent: {} }
  if (typeof window === 'undefined') return empty
  try {
    const parsed = JSON.parse(localStorage.getItem(AGENT_OPTIONS_STORAGE_KEY) || '') as Record<string, unknown>
    const agentId = text(parsed.agentId)
    if ([2, 3, 4].includes(Number(parsed.version)) && parsed.byAgent && typeof parsed.byAgent === 'object') {
      const byAgent = Object.fromEntries(
        Object.entries(parsed.byAgent as Record<string, unknown>).map(([id, value]) => {
          const options = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
          return [
            id,
            {
              model: text(options.model),
              reasoningEffort: text(options.reasoningEffort),
              serviceTier: text(options.serviceTier),
              allowSubagents: options.allowSubagents === true,
            },
          ]
        }),
      )
      return { version: 4, agentId, byAgent }
    }
    return {
      version: 4,
      agentId,
      byAgent: agentId
        ? {
            [agentId]: {
              model: text(parsed.model),
              reasoningEffort: text(parsed.reasoningEffort),
              serviceTier: '',
              allowSubagents: false,
            },
          }
        : {},
    }
  } catch {
    return empty
  }
}

export function agentLaunchOptions(agentId?: string): AgentLaunchOptions {
  const stored = storedAgentLaunchOptions()
  const selectedAgentId = agentId || stored.agentId
  const options = stored.byAgent[selectedAgentId]
  return {
    agentId: selectedAgentId,
    model: options?.model || '',
    reasoningEffort: options?.reasoningEffort || '',
    serviceTier: selectedAgentId === 'codex' ? options?.serviceTier || '' : '',
    allowSubagents: options?.allowSubagents === true,
  }
}

export function saveAgentLaunchOptions(value: AgentLaunchOptions) {
  const stored = storedAgentLaunchOptions()
  const agentId = text(value.agentId)
  const byAgent = { ...stored.byAgent }
  if (agentId)
    byAgent[agentId] = {
      model: text(value.model),
      reasoningEffort: text(value.reasoningEffort),
      serviceTier: agentId === 'codex' ? text(value.serviceTier) : '',
      allowSubagents: value.allowSubagents === true,
    }
  localStorage.setItem(AGENT_OPTIONS_STORAGE_KEY, JSON.stringify({ version: 4, agentId, byAgent } satisfies StoredAgentLaunchOptions))
  window.dispatchEvent(new CustomEvent(AGENT_OPTIONS_EVENT, { detail: value }))
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
      debounceTime(120),
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

import { createHash, randomUUID } from 'node:crypto'
import { OutboundRequestPolicy } from '@vertexade/platform-server/outbound-policy'
import { apiBackends as configuredBackends, resolveApiBackendInputs, type ApiBackend, type BackendInput } from './api-backend'
import {
  denormalizePayload,
  federatedIdSpan,
  localId,
  localWorkKey,
  mergeDashboardMeta,
  namespaceFromId,
  normalizeEntity,
  normalizeReadModelEntry,
  type BackendStatus,
} from './federated-backend'
import { dashboardCollections, type DashboardCollection, type ReadModelEntry, type ReadModelResponse } from './dashboard-cache-model'

type BackendRuntime = BackendStatus & {
  snapshot: ReadModelResponse | null
}

let activeBackends = configuredBackends
const linkedOutboundPolicy = new OutboundRequestPolicy()
let linkedBackendIds = new Set<string>()
let linkedServersCheckedAt = 0

const runtimeById = new Map<string, BackendRuntime>(
  activeBackends.map((backend) => [
    backend.id,
    {
      id: backend.id,
      label: backend.label,
      namespace: backend.namespace,
      isDefault: backend.isDefault,
      connected: false,
      lastConnectedAt: null,
      error: null,
      snapshot: null,
    },
  ]),
)
const federationInstanceId = `federated-${randomUUID()}`
let federationDigest = ''
let federationVersion = 0

function syncRuntime(backends: ApiBackend[]) {
  activeBackends = backends
  for (const backend of backends) {
    if (runtimeById.has(backend.id)) continue
    runtimeById.set(backend.id, {
      id: backend.id,
      label: backend.label,
      namespace: backend.namespace,
      isDefault: backend.isDefault,
      connected: false,
      lastConnectedAt: null,
      error: null,
      snapshot: null,
    })
  }
  for (const id of runtimeById.keys()) if (!backends.some((backend) => backend.id === id)) runtimeById.delete(id)
}

async function refreshLinkedServers(request: Request, source: URL, force = false) {
  if (!force && Date.now() - linkedServersCheckedAt < 5_000) return
  linkedServersCheckedAt = Date.now()
  const primary = configuredBackends[0]
  try {
    const response = await fetch(new URL('/api/settings/linked-servers', primary.url), {
      headers: proxyHeaders(source, request.headers),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
    })
    if (!response.ok) return
    const payload = (await response.json()) as {
      servers?: Array<{ id?: unknown; label?: unknown; url?: unknown; namespace?: unknown; enabled?: boolean }>
    }
    const linked = (payload.servers || []).filter((server) => server.enabled !== false)
    const uniqueLinked = linked.filter(
      (server) =>
        !configuredBackends.some(
          (backend) => backend.id === String(server.id || '').toLowerCase() || backend.url === String(server.url || '').replace(/\/$/, ''),
        ),
    )
    const inputs: BackendInput[] = [
      ...configuredBackends.map(({ id, label, url, namespace }) => ({ id, label, url, namespace })),
      ...uniqueLinked,
    ]
    const resolved = resolveApiBackendInputs(inputs)
    linkedBackendIds = new Set(resolved.slice(configuredBackends.length).map((backend) => backend.id))
    syncRuntime(resolved)
  } catch {
    // Retain the last usable linked-server topology while the primary is unavailable.
  }
}

function proxyHeaders(source: URL, requestHeaders: Headers) {
  const headers = new Headers(requestHeaders)
  const requestOrigin = headers.get('origin')
  if (requestOrigin) {
    try {
      const frontendOrigins = new Set([source.origin])
      const host = headers.get('host')
      if (host) frontendOrigins.add(new URL(`${source.protocol}//${host}`).origin)
      if (frontendOrigins.has(new URL(requestOrigin).origin)) headers.delete('origin')
    } catch {
      // Preserve malformed origins so the API CORS policy rejects them.
    }
  }
  headers.delete('host')
  headers.delete('content-length')
  headers.delete('x-vertexade-backend')
  return headers
}

function publicBackend(runtime: BackendRuntime) {
  return {
    id: runtime.id,
    label: runtime.label,
    namespace: runtime.namespace,
    isDefault: runtime.isDefault,
    connected: runtime.connected,
    lastConnectedAt: runtime.lastConnectedAt,
    error: runtime.error,
    apiPath: `/api/backends/${encodeURIComponent(runtime.id)}`,
  }
}

function publicBackends() {
  return activeBackends.map((backend) => publicBackend(runtimeById.get(backend.id)!))
}

function backendByNamespace(namespace: number | null) {
  return namespace === null ? undefined : activeBackends.find((backend) => backend.namespace === namespace)
}

function explicitBackend(pathname: string) {
  const match = pathname.match(/^\/api\/backends\/([^/]+)(\/.*)?$/)
  if (!match) return null
  const id = decodeURIComponent(match[1])
  const backend = activeBackends.find((candidate) => candidate.id === id)
  return backend ? { backend, pathname: `/api${match[2] || ''}` } : { backend: null, pathname }
}

function backendFromWorkKey(pathname: string) {
  const match = pathname.match(/^\/api\/work-items\/([^/]+)/)
  if (!match || /^\d+$/.test(match[1])) return null
  return activeBackends.find((backend) => backend.namespace > 0 && decodeURIComponent(match[1]).startsWith(`${backend.id}~`)) || null
}

const namespacedRoutePatterns = [
  /^\/api\/agent-threads\/(\d+)/,
  /^\/api\/repositories\/(\d+)/,
  /^\/api\/pulls\/(\d+)/,
  /^\/api\/work-items\/(\d+)/,
  /^\/api\/pr-tasks\/(\d+)/,
  /^\/api\/notifications\/(\d+)/,
]

function backendFromPath(pathname: string) {
  const workBackend = backendFromWorkKey(pathname)
  if (workBackend) return workBackend
  for (const pattern of namespacedRoutePatterns) {
    const match = pathname.match(pattern)
    if (!match) continue
    return backendByNamespace(namespaceFromId(match[1])) || activeBackends[0]
  }
  return null
}

function rewritePath(pathname: string, backend: ApiBackend) {
  let rewritten = pathname
  rewritten = rewritten.replace(/^\/api\/work-items\/([^/]+)/, (match, value: string) => {
    const local = localWorkKey(backend, decodeURIComponent(value))
    return match.replace(value, encodeURIComponent(local))
  })
  for (const pattern of namespacedRoutePatterns) {
    const match = rewritten.match(pattern)
    if (!match) continue
    rewritten = rewritten.replace(match[1], String(localId(match[1])))
    break
  }
  return rewritten
}

function rewriteSearch(search: URLSearchParams) {
  for (const name of ['repo_id', 'repository_id', 'job_id', 'source_job_id', 'work_item_id']) {
    const value = search.get(name)
    if (value && /^\d+$/.test(value)) search.set(name, String(localId(value)))
  }
  return search
}

function selectedBackend(source: URL, request: Request) {
  const explicit = explicitBackend(source.pathname)
  if (explicit) return explicit
  const requested = request.headers.get('x-vertexade-backend')
  const headerBackend = requested ? activeBackends.find((backend) => backend.id === requested) : undefined
  const backend = headerBackend || backendFromPath(source.pathname) || activeBackends[0]
  return { backend, pathname: source.pathname }
}

async function proxyBody(request: Request, backend: ApiBackend) {
  if (['GET', 'HEAD'].includes(request.method) || request.body === null) return undefined
  if (!request.headers.get('content-type')?.includes('application/json')) return request.body
  const raw = await request.clone().text()
  try {
    return JSON.stringify(denormalizePayload(JSON.parse(raw), backend))
  } catch {
    return request.body
  }
}

async function fetchBackend(request: Request, source: URL, backend: ApiBackend, pathname: string) {
  const target = new URL(rewritePath(pathname, backend), backend.url)
  target.search = rewriteSearch(new URLSearchParams(source.search)).toString()
  const body = await proxyBody(request, backend)
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: proxyHeaders(source, request.headers),
    body,
    signal: request.signal,
  }
  if (body) init.duplex = 'half'
  const runtime = runtimeById.get(backend.id)!
  try {
    const backendFetch = linkedBackendIds.has(backend.id) ? linkedOutboundPolicy.fetch : fetch
    const response = await backendFetch(target, init)
    runtime.connected = true
    runtime.lastConnectedAt = new Date().toISOString()
    runtime.error = null
    return response
  } catch (error) {
    runtime.connected = false
    runtime.error = errorMessage(error)
    throw error
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function readBackendModel(request: Request, source: URL, backend: ApiBackend) {
  const runtime = runtimeById.get(backend.id)!
  try {
    const target = new URL('/api/read-model?since=0', backend.url)
    const backendFetch = linkedBackendIds.has(backend.id) ? linkedOutboundPolicy.fetch : fetch
    const response = await backendFetch(target, {
      headers: proxyHeaders(source, request.headers),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = (await response.json()) as ReadModelResponse
    if (!payload.instanceId || !payload.updates) throw new Error('Invalid read-model response')
    runtime.connected = true
    runtime.lastConnectedAt = new Date().toISOString()
    runtime.error = null
    runtime.snapshot = payload
  } catch (error) {
    runtime.connected = false
    runtime.error = errorMessage(error)
  }
  return runtime.snapshot ? { backend: runtime as BackendStatus, payload: runtime.snapshot } : null
}

function modelEntries(payload: ReadModelResponse, collection: DashboardCollection) {
  const update = payload.updates[collection]
  return (update?.entries || update?.upserts || []) as ReadModelEntry[]
}

function mergedReadModel(models: Array<{ backend: BackendStatus; payload: ReadModelResponse }>) {
  const statuses = publicBackends()
  const versionIdentity = JSON.stringify(
    activeBackends.map((backend) => {
      const runtime = runtimeById.get(backend.id)!
      return [backend.id, runtime.connected, runtime.snapshot?.instanceId, runtime.snapshot?.version, runtime.error]
    }),
  )
  const nextDigest = createHash('sha256').update(versionIdentity).digest('hex')
  if (nextDigest !== federationDigest) {
    federationDigest = nextDigest
    federationVersion = Math.max(Date.now(), federationVersion + 1)
  }
  const updates = Object.fromEntries(
    dashboardCollections.map((collection) => {
      const entries =
        collection === 'dashboardMeta'
          ? [mergeDashboardMeta(models, statuses)]
          : models.flatMap(({ backend, payload }) =>
              modelEntries(payload, collection).map((entry) => normalizeReadModelEntry(collection, entry, backend)),
            )
      return [
        collection,
        {
          version: federationVersion,
          mode: 'replace',
          entries: entries.map((entry, position) => ({ ...entry, position })),
        },
      ]
    }),
  ) as ReadModelResponse['updates']
  return { instanceId: federationInstanceId, version: federationVersion, updates }
}

async function federatedReadModel(request: Request, source: URL) {
  const models = (await Promise.all(activeBackends.map((backend) => readBackendModel(request, source, backend)))).filter(
    (model): model is { backend: BackendStatus; payload: ReadModelResponse } => model !== null,
  )
  if (!models.length) {
    return Response.json({ error: 'None of the configured backends could be reached', backends: publicBackends() }, { status: 502 })
  }
  const payload = mergedReadModel(models)
  const since = Number(source.searchParams.get('since') || 0)
  const instance = source.searchParams.get('instance')
  if (instance === payload.instanceId && since === payload.version) payload.updates = {}
  return Response.json(payload)
}

async function normalizeResponse(response: Response, backend: ApiBackend) {
  if (activeBackends.length === 1 || !response.headers.get('content-type')?.includes('application/json')) return response
  const runtime = runtimeById.get(backend.id)!
  const body = normalizeEntity(await response.json(), runtime)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json(body, { status: response.status, statusText: response.statusText, headers })
}

export async function proxyApiRequest({ request }: { request: Request }) {
  const source = new URL(request.url)
  await refreshLinkedServers(request, source, source.pathname === '/api/backends')
  if (source.pathname === '/api/backends' && request.method === 'GET') return Response.json({ backends: publicBackends() })
  if (source.pathname === '/api/read-model' && request.method === 'GET' && activeBackends.length > 1) {
    return federatedReadModel(request, source)
  }
  const selected = selectedBackend(source, request)
  if (!selected.backend) return Response.json({ error: 'Backend not found' }, { status: 404 })
  if (selected.backend.namespace * federatedIdSpan > Number.MAX_SAFE_INTEGER) {
    return Response.json({ error: 'Backend namespace exceeds the supported federation range' }, { status: 500 })
  }
  const response = await fetchBackend(request, source, selected.backend, selected.pathname)
  if (source.pathname.startsWith('/api/settings/linked-servers') && request.method !== 'GET') linkedServersCheckedAt = 0
  return normalizeResponse(response, selected.backend)
}

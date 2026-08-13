import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { AsyncLocalStorage } from 'node:async_hooks'
import { HttpError, readRequestBody, readResponseBody } from '@vertexade/platform-server/http'
import { OutboundRequestPolicy } from '@vertexade/platform-server/outbound-policy'
import { apiBackends as configuredBackends, resolveApiBackendInputs, type ApiBackend, type BackendInput } from './api-backend'
import { browserPairingHeader, parseBrowserPairLink, readBrowserPairedServers, type BrowserPairedServer } from './browser-pairing'
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
import {
  dashboardCollections,
  maxFederatedReadModelResponseBytes,
  type DashboardCollection,
  type ReadModelEntry,
  type ReadModelResponse,
} from './dashboard-cache-model'

type BackendRuntime = BackendStatus & {
  snapshot: ReadModelResponse | null
}

const MAX_PROXY_JSON_REQUEST_BYTES = 100_000
const MAX_PROMPT_IMAGE_REQUEST_BYTES = 28 * 1024 * 1024
const MAX_LINKED_SERVERS_RESPONSE_BYTES = 256 * 1024
const MAX_BACKEND_READ_MODEL_RESPONSE_BYTES = 32 * 1024 * 1024
const MAX_NORMALIZED_JSON_RESPONSE_BYTES = 16 * 1024 * 1024

type RequestBackendContext = { backends: ApiBackend[]; paired: Map<string, BrowserPairedServer>; outbound: OutboundRequestPolicy | null }
const backendContext = new AsyncLocalStorage<RequestBackendContext>()
const activeBackends = () => backendContext.getStore()?.backends || configuredBackends
let linkedOutboundPolicy = new OutboundRequestPolicy()
let linkedAllowedOriginsKey = ''
let linkedBackendIds = new Set<string>()
let linkedServersCheckedAt = 0
const pairedSessionCache = new Map<string, number>()

type ClientIdentity = 'unrestricted' | 'local' | 'mobile' | 'public'

const runtimeById = new Map<string, BackendRuntime>(
  configuredBackends.map((backend) => [
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
  const context = backendContext.getStore()
  if (context) context.backends = backends
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
}

async function refreshLinkedServers(request: Request, source: URL, identity: ClientIdentity, force = false) {
  if (!force && Date.now() - linkedServersCheckedAt < 5_000) return
  linkedServersCheckedAt = Date.now()
  const primary = configuredBackends[0]
  try {
    const response = await fetch(new URL('/api/settings/linked-servers', primary.url), {
      headers: proxyHeaders(source, request.headers, identity === 'local' || identity === 'unrestricted' ? 'all' : 'none'),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
    })
    if (!response.ok) return
    const payload = (await boundedJsonResponse(response, 'Linked-server discovery', MAX_LINKED_SERVERS_RESPONSE_BYTES, request.signal)) as {
      servers?: Array<{ id?: unknown; label?: unknown; url?: unknown; namespace?: unknown; enabled?: boolean }>
    }
    const linked = (payload.servers || []).filter((server) => server.enabled !== false)
    const uniqueLinked = linked.filter(
      (server) =>
        !activeBackends().some(
          (backend) => backend.id === String(server.id || '').toLowerCase() || backend.url === String(server.url || '').replace(/\/$/, ''),
        ),
    )
    const inputs: BackendInput[] = [
      ...activeBackends().map(({ id, label, url, namespace }) => ({ id, label, url, namespace })),
      ...uniqueLinked,
    ]
    const resolved = resolveApiBackendInputs(inputs)
    linkedBackendIds = new Set(resolved.slice(activeBackends().length).map((backend) => backend.id))
    const allowedOrigins = resolved.slice(activeBackends().length).map((backend) => backend.url)
    const allowedOriginsKey = [...allowedOrigins].sort().join('\n')
    if (allowedOriginsKey !== linkedAllowedOriginsKey) {
      const previousPolicy = linkedOutboundPolicy
      linkedOutboundPolicy = new OutboundRequestPolicy({ allowedOrigins })
      linkedAllowedOriginsKey = allowedOriginsKey
      const disposal = setTimeout(() => void previousPolicy.dispose(), 30_000)
      disposal.unref()
    }
    syncRuntime(resolved)
  } catch {
    // Retain the last usable linked-server topology while the primary is unavailable.
  }
}

const crossBackendCredentialHeaders = ['authorization', 'cookie', 'proxy-authorization'] as const

type CrossBackendCredentialPolicy = 'all' | 'authorization' | 'none'

function proxyHeaders(source: URL, requestHeaders: Headers, credentialPolicy: CrossBackendCredentialPolicy = 'all') {
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
  headers.delete('x-vertexade-local-session')
  headers.delete(browserPairingHeader)
  if (credentialPolicy !== 'all') {
    for (const name of crossBackendCredentialHeaders) {
      if (name !== 'authorization' || credentialPolicy !== 'authorization') headers.delete(name)
    }
  }
  return headers
}

function pairedClientsRequired(): boolean {
  return process.env.VERTEXADE_REQUIRE_PAIRED_CLIENTS === '1'
}

function constantTimeTextMatch(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}

function bearerAuthorization(request: Request): string {
  const value = request.headers.get('authorization') || ''
  return value.startsWith('Bearer ') && value.slice(7).trim() ? value : ''
}

function publicPairingRequest(pathname: string, method: string): boolean {
  return method === 'OPTIONS' || (method === 'POST' && pathname === '/api/mobile-pairing/redeem')
}

function localClientAuthorized(request: Request): boolean {
  const expected = process.env.VERTEXADE_LOCAL_SESSION_TOKEN || ''
  const actual = request.headers.get('x-vertexade-local-session') || ''
  return Boolean(expected && actual && constantTimeTextMatch(actual, expected))
}

function mobileSessionCacheKey(authorization: string): string {
  return createHash('sha256').update(authorization).digest('base64url')
}

function cachedMobileSession(cacheKey: string): boolean {
  return (pairedSessionCache.get(cacheKey) || 0) > Date.now()
}

function cacheMobileSession(cacheKey: string): void {
  const oldest = pairedSessionCache.keys().next().value
  if (pairedSessionCache.size >= 256 && oldest) pairedSessionCache.delete(oldest)
  pairedSessionCache.set(cacheKey, Date.now() + 5_000)
}

async function validateMobileSession(request: Request, authorization: string, cacheKey: string): Promise<boolean> {
  const primary = configuredBackends[0]
  try {
    const response = await fetch(new URL('/api/mobile-pairing/session/validate', primary.url), {
      method: 'POST',
      headers: { authorization },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
    })
    if (!response.ok) return false
    cacheMobileSession(cacheKey)
    return true
  } catch {
    return false
  }
}

async function authorizeClient(request: Request, source: URL): Promise<ClientIdentity | null> {
  if (!pairedClientsRequired()) return 'unrestricted'
  if (publicPairingRequest(source.pathname, request.method)) return 'public'
  if (localClientAuthorized(request)) return 'local'

  const authorization = bearerAuthorization(request)
  if (!authorization) return null
  const cacheKey = mobileSessionCacheKey(authorization)
  if (cachedMobileSession(cacheKey)) return 'mobile'
  return (await validateMobileSession(request, authorization, cacheKey)) ? 'mobile' : null
}

function crossBackendCredentialPolicy(pathname: string, method: string): CrossBackendCredentialPolicy {
  if (['POST', 'PATCH'].includes(method) && /^\/api\/settings\/linked-servers(?:\/[^/]+)?$/.test(pathname)) return 'authorization'
  return 'none'
}

function publicBackend(runtime: BackendRuntime) {
  const paired = backendContext.getStore()?.paired.has(runtime.id) || false
  return {
    id: runtime.id,
    label: runtime.label,
    namespace: runtime.namespace,
    isDefault: runtime.isDefault,
    connected: runtime.connected,
    lastConnectedAt: runtime.lastConnectedAt,
    error: runtime.error,
    apiPath: `/api/backends/${encodeURIComponent(runtime.id)}`,
    realtime: !paired,
  }
}

function publicBackends() {
  return activeBackends().map((backend) => publicBackend(runtimeById.get(backend.id)!))
}

function backendByNamespace(namespace: number | null) {
  return namespace === null ? undefined : activeBackends().find((backend) => backend.namespace === namespace)
}

function explicitBackend(pathname: string) {
  const match = pathname.match(/^\/api\/backends\/([^/]+)(\/.*)?$/)
  if (!match) return null
  const id = decodeURIComponent(match[1])
  const backend = activeBackends().find((candidate) => candidate.id === id)
  return backend ? { backend, pathname: `/api${match[2] || ''}` } : { backend: null, pathname }
}

function backendFromWorkKey(pathname: string) {
  const match = pathname.match(/^\/api\/work-items\/([^/]+)/)
  if (!match || /^\d+$/.test(match[1])) return null
  return activeBackends().find((backend) => backend.namespace > 0 && decodeURIComponent(match[1]).startsWith(`${backend.id}~`)) || null
}

const namespacedRoutePatterns = [
  /^\/api\/migration-campaigns\/(\d+)/,
  /^\/api\/extensions\/container-preview\/agent-threads\/(\d+)/,
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
    return backendByNamespace(namespaceFromId(match[1])) || activeBackends()[0]
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
  for (const pattern of [
    /\/validation-runs\/(\d+)/,
    /\/impact-analyses\/(\d+)/,
    /\/architecture-index\/(\d+)/,
    /\/development-knowledge\/(\d+)/,
  ]) {
    const match = rewritten.match(pattern)
    if (match) rewritten = rewritten.replace(match[1], String(localId(match[1])))
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
  const headerBackend = requested ? activeBackends().find((backend) => backend.id === requested) : undefined
  // Entity ownership is authoritative. A global UI selection is only a
  // default for routes that do not identify their owning backend.
  const backend = backendFromPath(source.pathname) || headerBackend || activeBackends()[0]
  return { backend, pathname: source.pathname }
}

async function proxyBody(request: Request, backend: ApiBackend, pathname: string) {
  if (['GET', 'HEAD'].includes(request.method) || request.body === null) return undefined
  if (!request.headers.get('content-type')?.includes('application/json')) return request.body
  const maxBytes = pathname === '/api/prompt-images' ? MAX_PROMPT_IMAGE_REQUEST_BYTES : MAX_PROXY_JSON_REQUEST_BYTES
  const raw = (await readRequestBody(request.clone(), maxBytes)).toString('utf8')
  try {
    return JSON.stringify(denormalizePayload(JSON.parse(raw), backend))
  } catch {
    return request.body
  }
}

function backendCredentialPolicy(
  identity: ClientIdentity,
  backend: ApiBackend,
  pathname: string,
  method: string,
): CrossBackendCredentialPolicy {
  if (identity === 'mobile' || identity === 'public') return 'none'
  return backend.isDefault ? 'all' : crossBackendCredentialPolicy(pathname, method)
}

async function fetchBackend(request: Request, source: URL, backend: ApiBackend, pathname: string, identity: ClientIdentity) {
  const target = new URL(rewritePath(pathname, backend), backend.url)
  target.search = rewriteSearch(new URLSearchParams(source.search)).toString()
  const body = await proxyBody(request, backend, target.pathname)
  const headers = proxyHeaders(source, request.headers, backendCredentialPolicy(identity, backend, pathname, request.method))
  const paired = backendContext.getStore()?.paired.get(backend.id)
  if (paired) headers.set('authorization', `Bearer ${paired.sessionToken}`)
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  }
  if (body) init.duplex = 'half'
  const runtime = runtimeById.get(backend.id)!
  try {
    const backendFetch = paired
      ? backendContext.getStore()?.outbound?.fetch || fetch
      : linkedBackendIds.has(backend.id)
        ? linkedOutboundPolicy.fetch
        : fetch
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

function readModelCredentialPolicy(identity: ClientIdentity, backend: ApiBackend): CrossBackendCredentialPolicy {
  if (identity !== 'local' && identity !== 'unrestricted') return 'none'
  return backend.isDefault ? 'all' : 'none'
}

function validReadModelPayload(value: unknown): value is ReadModelResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Partial<ReadModelResponse>
  return Boolean(payload.instanceId && payload.updates)
}

function runtimeReadModel(runtime: BackendRuntime): FederatedModel | null {
  if (!runtime.snapshot) return null
  return { backend: runtime as BackendStatus, payload: runtime.snapshot }
}

async function readBackendModel(request: Request, source: URL, backend: ApiBackend, maxResponseBytes: number, identity: ClientIdentity) {
  const runtime = runtimeById.get(backend.id)!
  try {
    const target = new URL('/api/read-model?since=0', backend.url)
    const paired = backendContext.getStore()?.paired.get(backend.id)
    const headers = proxyHeaders(source, request.headers, readModelCredentialPolicy(identity, backend))
    if (paired) headers.set('authorization', `Bearer ${paired.sessionToken}`)
    const backendFetch = paired
      ? backendContext.getStore()?.outbound?.fetch || fetch
      : linkedBackendIds.has(backend.id)
        ? linkedOutboundPolicy.fetch
        : fetch
    const response = await backendFetch(target, {
      headers,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await boundedJsonResponse(response, 'Federated read model', maxResponseBytes, request.signal)
    if (!validReadModelPayload(payload)) throw new Error('Invalid read-model response')
    runtime.connected = true
    runtime.lastConnectedAt = new Date().toISOString()
    runtime.error = null
    runtime.snapshot = payload
  } catch (error) {
    runtime.connected = false
    runtime.error = errorMessage(error)
  }
  return runtimeReadModel(runtime)
}

function modelEntries(payload: ReadModelResponse, collection: DashboardCollection) {
  const update = payload.updates[collection]
  return (update?.entries || update?.upserts || []) as ReadModelEntry[]
}

type FederatedModel = { backend: BackendStatus; payload: ReadModelResponse }

function nextFederationVersion(backends: ApiBackend[]) {
  const versionIdentity = JSON.stringify(
    backends.map((backend) => {
      const runtime = runtimeById.get(backend.id)!
      return [backend.id, runtime.connected, runtime.snapshot?.instanceId, runtime.snapshot?.version, runtime.error]
    }),
  )
  const nextDigest = createHash('sha256').update(versionIdentity).digest('hex')
  if (nextDigest !== federationDigest) {
    federationDigest = nextDigest
    federationVersion = Math.max(Date.now(), federationVersion + 1)
  }
  return federationVersion
}

function mergedReadModel(models: FederatedModel[], backends: ApiBackend[], version: number) {
  const statuses = backends.map((backend) => publicBackend(runtimeById.get(backend.id)!))
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
          version,
          mode: 'replace',
          entries: entries.map((entry, position) => ({ ...entry, position })),
        },
      ]
    }),
  ) as ReadModelResponse['updates']
  return { instanceId: federationInstanceId, version, updates }
}

function responseBytes(payload: ReadModelResponse) {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8')
}

function modelsWithinAggregateBudget(models: FederatedModel[], backends: ApiBackend[]) {
  const accepted = [...models]
  while (accepted.length) {
    const probe = mergedReadModel(accepted, backends, Number.MAX_SAFE_INTEGER)
    if (responseBytes(probe) <= maxFederatedReadModelResponseBytes) break
    const rejected = accepted.pop()!
    const runtime = runtimeById.get(rejected.backend.id)
    if (runtime) {
      runtime.connected = false
      runtime.error = 'Normalized read model exceeds the federated response budget'
    }
  }
  return accepted
}

async function federatedReadModel(request: Request, source: URL, identity: ClientIdentity) {
  const backends = [...activeBackends()]
  const perBackendLimit = Math.min(MAX_BACKEND_READ_MODEL_RESPONSE_BYTES, Math.floor(maxFederatedReadModelResponseBytes / backends.length))
  const models = (
    await Promise.all(backends.map((backend) => readBackendModel(request, source, backend, perBackendLimit, identity)))
  ).filter((model): model is FederatedModel => model !== null)
  if (!models.length) {
    return Response.json({ error: 'None of the configured backends could be reached', backends: publicBackends() }, { status: 502 })
  }
  const acceptedModels = modelsWithinAggregateBudget(models, backends)
  if (!acceptedModels.length) {
    return Response.json({ error: 'No backend read model fits the federated response budget', backends: publicBackends() }, { status: 502 })
  }
  const payload = mergedReadModel(acceptedModels, backends, nextFederationVersion(backends))
  const since = Number(source.searchParams.get('since') || 0)
  const instance = source.searchParams.get('instance')
  if (instance === payload.instanceId && since === payload.version) payload.updates = {}
  const body = JSON.stringify(payload)
  const bodyBytes = Buffer.byteLength(body, 'utf8')
  if (bodyBytes > maxFederatedReadModelResponseBytes) throw new Error('Federated read-model budget invariant failed')
  return new Response(body, {
    headers: {
      'content-length': String(bodyBytes),
      'content-type': 'application/json',
    },
  })
}

async function boundedJsonResponse(response: Response, service: string, maxBytes: number, signal?: AbortSignal | null) {
  const raw = (await readResponseBody(response, maxBytes, signal)).toString('utf8')
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error(`${service} returned invalid JSON`)
  }
}

async function normalizeResponse(response: Response, backend: ApiBackend, signal: AbortSignal) {
  if (activeBackends().length === 1 || !response.headers.get('content-type')?.includes('application/json')) return response
  const runtime = runtimeById.get(backend.id)!
  const body = normalizeEntity(await boundedJsonResponse(response, 'Backend API', MAX_NORMALIZED_JSON_RESPONSE_BYTES, signal), runtime)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json(body, { status: response.status, statusText: response.statusText, headers })
}

async function proxyApiRequestInContext({ request }: { request: Request }) {
  const source = new URL(request.url)
  const identity = await authorizeClient(request, source)
  if (!identity) return Response.json({ error: 'Pair this device in VertexADE Desktop Settings' }, { status: 401 })
  if (source.pathname === '/api/browser-pairing/redeem' && request.method === 'POST') return redeemBrowserPairing(request)
  if (identity !== 'public') await refreshLinkedServers(request, source, identity, source.pathname === '/api/backends')
  if (source.pathname === '/api/backends' && request.method === 'GET') return Response.json({ backends: publicBackends() })
  if (source.pathname === '/api/read-model' && request.method === 'GET' && activeBackends().length > 1) {
    return federatedReadModel(request, source, identity)
  }
  const selected = selectedBackend(source, request)
  if (!selected.backend) return Response.json({ error: 'Backend not found' }, { status: 404 })
  if (selected.backend.namespace * federatedIdSpan > Number.MAX_SAFE_INTEGER) {
    return Response.json({ error: 'Backend namespace exceeds the supported federation range' }, { status: 500 })
  }
  let response: Response
  try {
    response = await fetchBackend(request, source, selected.backend, selected.pathname, identity)
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
  if (source.pathname.startsWith('/api/settings/linked-servers') && request.method !== 'GET') linkedServersCheckedAt = 0
  return normalizeResponse(response, selected.backend, request.signal)
}

async function redeemBrowserPairing(request: Request) {
  let input: Record<string, unknown>
  try {
    input = JSON.parse((await readRequestBody(request.clone(), 16 * 1024)).toString('utf8')) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Pairing request is invalid' }, { status: 400 })
  }
  let pairing: ReturnType<typeof parseBrowserPairLink>
  try {
    pairing = parseBrowserPairLink(String(input.pairUrl || ''))
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 })
  }
  const policy = new OutboundRequestPolicy({ allowedOrigins: [pairing.serviceUrl] })
  try {
    const response = await policy.fetch(new URL('/api/mobile-pairing/redeem', pairing.serviceUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: pairing.token, deviceName: String(input.deviceName || 'VertexADE Web') }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
    })
    const payload = await boundedJsonResponse(response, 'Pairing redemption', 64 * 1024, request.signal).catch(() => null)
    if (!response.ok)
      return Response.json(recordError(payload) || { error: `Pairing failed with HTTP ${response.status}` }, { status: response.status })
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      return Response.json({ error: 'Invalid pairing response' }, { status: 502 })
    const redemption = payload as Record<string, unknown>
    if (
      String(redemption.serviceUrl || '').replace(/\/$/, '') !== pairing.serviceUrl ||
      !String(redemption.sessionToken || '').trim() ||
      Date.parse(String(redemption.expiresAt || '')) <= Date.now()
    )
      return Response.json({ error: 'Invalid pairing response' }, { status: 502 })
    return Response.json(redemption, { status: 201 })
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 502 })
  } finally {
    await policy.dispose()
  }
}

function recordError(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const error = String((value as Record<string, unknown>).error || '').trim()
  return error ? { error } : null
}

function requestPairedServers(request: Request) {
  const raw = request.headers.get(browserPairingHeader)
  if (!raw || raw.length > 24_000) return []
  try {
    const serialized = decodeURIComponent(raw)
    return readBrowserPairedServers({ getItem: () => serialized })
  } catch {
    return []
  }
}

function pairedRequestContext(request: Request): RequestBackendContext {
  const usedIds = new Set(configuredBackends.map(({ id }) => id))
  const usedNamespaces = new Set(configuredBackends.map(({ namespace }) => namespace))
  const pairedServers = requestPairedServers(request).filter((server) => {
    if (usedIds.has(server.id) || usedNamespaces.has(server.namespace) || configuredBackends.some(({ url }) => url === server.serviceUrl))
      return false
    usedIds.add(server.id)
    usedNamespaces.add(server.namespace)
    return true
  })
  const paired = new Map(pairedServers.map((server) => [server.id, server]))
  const backends = resolveApiBackendInputs([
    ...configuredBackends.map(({ id, label, url, namespace }) => ({ id, label, url, namespace })),
    ...pairedServers.map((server) => ({ id: server.id, label: server.name, url: server.serviceUrl, namespace: server.namespace })),
  ])
  syncRuntime(backends)
  return {
    backends,
    paired,
    outbound: pairedServers.length
      ? new OutboundRequestPolicy({ allowedOrigins: pairedServers.map(({ serviceUrl }) => serviceUrl) })
      : null,
  }
}

export async function proxyApiRequest({ request }: { request: Request }) {
  const context = pairedRequestContext(request)
  return backendContext.run(context, async () => {
    try {
      return await proxyApiRequestInContext({ request })
    } finally {
      await context.outbound?.dispose()
    }
  })
}

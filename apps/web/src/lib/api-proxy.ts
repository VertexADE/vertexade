import { createHash, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { AsyncLocalStorage } from 'node:async_hooks'
import { HttpError, readRequestBody, readResponseBody } from '@vertexade/platform-server/http'
import { OutboundRequestPolicy } from '@vertexade/platform-server/outbound-policy'
import { apiBackends as configuredBackends, resolveApiBackendInputs, type ApiBackend } from './api-backend'
import { browserPairingHeader, type BrowserPairedServer } from './browser-pairing'
import { browserCredential, browserSessionAuthorization } from './browser-pairing-session'
import { migrateBrowserPairings, redeemBrowserPairing, revokeBrowserCredential } from './api-proxy-browser-pairing'
import { hasMixedBackendBatch, requestPairedServers } from './api-proxy-request-validation'
import { createRequestRuntimeState, type BackendRuntime, type FederationRuntime } from './api-proxy-runtime'
import {
  denormalizePayload,
  federatedId,
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

const MAX_PROXY_JSON_REQUEST_BYTES = 100_000
const MAX_PROMPT_IMAGE_REQUEST_BYTES = 28 * 1024 * 1024
const MAX_BACKEND_READ_MODEL_RESPONSE_BYTES = 32 * 1024 * 1024
const MAX_NORMALIZED_JSON_RESPONSE_BYTES = 16 * 1024 * 1024

type RequestBackendContext = {
  backends: ApiBackend[]
  paired: Map<string, BrowserPairedServer>
  outbound: OutboundRequestPolicy | null
  runtimes: Map<string, BackendRuntime>
  federation: FederationRuntime
}
const backendContext = new AsyncLocalStorage<RequestBackendContext>()
const activeBackends = () => backendContext.getStore()?.backends || configuredBackends
const pairedSessionCache = new Map<string, number>()

type ClientIdentity = 'unrestricted' | 'local' | 'mobile' | 'public'

function runtimeForId(id: string) {
  const runtime = backendContext.getStore()?.runtimes.get(id)
  if (!runtime) throw new Error(`Backend runtime ${id} is unavailable outside its request context`)
  return runtime
}

function runtimeFor(backend: Pick<ApiBackend, 'id'>) {
  return runtimeForId(backend.id)
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

function pairedBrowserAuthorization() {
  const paired = backendContext.getStore()?.paired
  if (!paired) return ''
  for (const backend of configuredBackends) {
    const server = paired.get(backend.id)
    if (server?.sessionToken) return `Bearer ${server.sessionToken}`
  }
  return ''
}

function publicPairingRequest(pathname: string, method: string): boolean {
  return method === 'OPTIONS' || (method === 'POST' && ['/api/mobile-pairing/redeem', '/api/browser-pairing/redeem'].includes(pathname))
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

  const authorization = bearerAuthorization(request) || browserSessionAuthorization(request) || pairedBrowserAuthorization()
  if (!authorization) return null
  const cacheKey = mobileSessionCacheKey(authorization)
  if (cachedMobileSession(cacheKey)) return 'mobile'
  return (await validateMobileSession(request, authorization, cacheKey)) ? 'mobile' : null
}

function crossBackendCredentialPolicy(pathname: string, method: string): CrossBackendCredentialPolicy {
  // Keep the legacy API operable for older clients while the current web UI
  // exclusively uses independent browser pairing.
  if (['POST', 'PATCH'].includes(method) && /^\/api\/settings\/linked-servers(?:\/[^/]+)?$/.test(pathname)) return 'authorization'
  return 'none'
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
    realtime: true,
  }
}

function publicBackends() {
  return activeBackends().map((backend) => publicBackend(runtimeFor(backend)))
}

function nextAvailableNamespace() {
  const used = new Set(activeBackends().map((backend) => backend.namespace))
  let namespace = 1
  while (used.has(namespace)) namespace += 1
  return namespace
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

function backendFromInboxKey(pathname: string) {
  const match = pathname.match(/^\/api\/inbox\/([^/]+)/)
  if (!match) return null
  const value = decodeURIComponent(match[1])
  return activeBackends().find((backend) => value.startsWith(`${backend.id}~`)) || null
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
  const inboxBackend = backendFromInboxKey(pathname)
  if (inboxBackend) return inboxBackend
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
  rewritten = rewritten.replace(/^\/api\/inbox\/([^/]+)/, (match, value: string) => {
    const decoded = decodeURIComponent(value)
    const local = decoded.startsWith(`${backend.id}~`) ? decoded.slice(backend.id.length + 1) : decoded
    return match.replace(value, encodeURIComponent(local))
  })
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
  // Entity ownership is authoritative. Explicit headers are reserved for
  // page-local server scopes such as Settings and extension workspaces.
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
  const runtime = runtimeFor(backend)
  try {
    const backendFetch = paired ? backendContext.getStore()?.outbound?.fetch || fetch : fetch
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
  const runtime = runtimeFor(backend)
  try {
    const target = new URL('/api/read-model?since=0', backend.url)
    const paired = backendContext.getStore()?.paired.get(backend.id)
    const headers = proxyHeaders(source, request.headers, readModelCredentialPolicy(identity, backend))
    if (paired) headers.set('authorization', `Bearer ${paired.sessionToken}`)
    const backendFetch = paired ? backendContext.getStore()?.outbound?.fetch || fetch : fetch
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
  const federation = backendContext.getStore()?.federation
  if (!federation) throw new Error('Federation runtime is unavailable outside its request context')
  const versionIdentity = JSON.stringify(
    backends.map((backend) => {
      const runtime = runtimeFor(backend)
      return [backend.id, runtime.connected, runtime.snapshot?.instanceId, runtime.snapshot?.version, runtime.error]
    }),
  )
  const nextDigest = createHash('sha256').update(versionIdentity).digest('hex')
  if (nextDigest !== federation.digest) {
    federation.digest = nextDigest
    federation.version = Math.max(Date.now(), federation.version + 1)
  }
  return federation.version
}

function mergedReadModel(models: FederatedModel[], backends: ApiBackend[], version: number) {
  const statuses = backends.map((backend) => publicBackend(runtimeFor(backend)))
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
  const instanceId = backendContext.getStore()?.federation.instanceId
  if (!instanceId) throw new Error('Federation runtime is unavailable outside its request context')
  return { instanceId, version, updates }
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
    const runtime = runtimeForId(rejected.backend.id)
    runtime.connected = false
    runtime.error = 'Normalized read model exceeds the federated response budget'
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
  const runtime = runtimeFor(backend)
  const body = normalizeEntity(await boundedJsonResponse(response, 'Backend API', MAX_NORMALIZED_JSON_RESPONSE_BYTES, signal), runtime)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json(body, { status: response.status, statusText: response.statusText, headers })
}

async function proxyApiRequestInContext({ request }: { request: Request }) {
  const source = new URL(request.url)
  const identity = await authorizeClient(request, source)
  if (!identity) return Response.json({ error: 'Pair this browser with this VertexADE server in Settings' }, { status: 401 })
  if (source.pathname === '/api/browser-pairing/redeem' && request.method === 'POST')
    return redeemBrowserPairing(request, new Set(configuredBackends.map((backend) => backend.url)), nextAvailableNamespace())
  if (source.pathname === '/api/browser-pairing/migrate' && request.method === 'POST') return migrateBrowserPairings(request)
  if (source.pathname === '/api/browser-pairing/credential' && request.method === 'DELETE') return revokeBrowserCredential(request)
  if (source.pathname === '/api/backends' && request.method === 'GET') return Response.json({ backends: publicBackends() })
  if (source.pathname === '/api/read-model' && request.method === 'GET' && activeBackends().length > 1) {
    return federatedReadModel(request, source, identity)
  }
  if (
    request.method === 'GET' &&
    activeBackends().length > 1 &&
    ['/api/inbox', '/api/search', '/api/notifications'].includes(source.pathname)
  ) {
    return federatedCollection(request, source, identity)
  }
  if (activeBackends().length > 1 && source.pathname === '/api/notifications/read' && request.method === 'POST') {
    return federatedMutation(request, source, identity, () => ({ read: true }))
  }
  if (activeBackends().length > 1 && source.pathname === '/api/notifications' && request.method === 'DELETE') {
    return federatedMutation(request, source, identity, (values) => ({
      pruned: values.reduce<number>((total, value) => total + Number(record(value)?.pruned || 0), 0),
    }))
  }
  if (activeBackends().length > 1 && source.pathname === '/api/repositories/sync-all' && request.method === 'POST') {
    return federatedMutation(request, source, identity, (values) => ({
      repositories: values.reduce<number>((total, value) => total + Number(record(value)?.repositories || 0), 0),
      open_prs: values.reduce<number>((total, value) => total + Number(record(value)?.open_prs || 0), 0),
      errors: values.flatMap((value) => (Array.isArray(record(value)?.errors) ? (record(value)!.errors as unknown[]) : [])),
    }))
  }
  if (await hasMixedBackendBatch(request, source.pathname)) {
    return Response.json({ error: 'Batch operations must target one server at a time' }, { status: 400 })
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
  return normalizeResponse(response, selected.backend, request.signal)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

async function backendJson(request: Request, source: URL, backend: ApiBackend, identity: ClientIdentity) {
  const response = await fetchBackend(request, source, backend, source.pathname, identity)
  if (!response.ok) {
    const runtime = runtimeFor(backend)
    runtime.connected = false
    runtime.error = `HTTP ${response.status}`
    throw new Error(`${backend.label}: HTTP ${response.status}`)
  }
  return boundedJsonResponse(response, backend.label, MAX_NORMALIZED_JSON_RESPONSE_BYTES, request.signal)
}

async function federatedValues(request: Request, source: URL, identity: ClientIdentity) {
  const results = await Promise.allSettled(
    activeBackends().map(async (backend) => ({ backend, value: await backendJson(request, source, backend, identity) })),
  )
  const values = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const failures = activeBackends().flatMap((backend, index) => {
    const result = results[index]
    return result?.status === 'rejected' ? [{ backendId: backend.id, backendName: backend.label, error: errorMessage(result.reason) }] : []
  })
  if (!values.length) return null
  return { values, failures }
}

function federatedDestination(value: unknown, backend: ApiBackend) {
  const destination = String(value || '')
  return destination
    .replace(/^\/work\/([^/?#]+)/, (_match, key: string) => `/work/${encodeURIComponent(`${backend.id}~${decodeURIComponent(key)}`)}`)
    .replace(/([?&]thread=)(\d+)/, (_match, prefix: string, id: string) => `${prefix}${federatedId(backend, id)}`)
    .replace(/([?&]repo=)(\d+)/, (_match, prefix: string, id: string) => `${prefix}${federatedId(backend, id)}`)
}

async function federatedCollection(request: Request, source: URL, identity: ClientIdentity) {
  const federation = await federatedValues(request, source, identity)
  if (!federation)
    return Response.json({ error: 'None of the paired servers could be reached', backends: publicBackends() }, { status: 502 })
  const { values, failures } = federation
  const meta = { federation: { connected: values.length, total: values.length + failures.length, failures } }
  if (source.pathname === '/api/inbox') {
    const items: Record<string, unknown>[] = values
      .flatMap(({ backend, value }) => {
        const payload = record(value)
        return Array.isArray(payload?.items)
          ? payload.items.flatMap((item) => {
              const entry = record(item)
              return entry
                ? [
                    {
                      ...entry,
                      id: `${backend.id}~${String(entry.id || '')}`,
                      href: federatedDestination(entry.href, backend),
                      backend_id: backend.id,
                      backend_name: backend.label,
                    } as Record<string, unknown>,
                  ]
                : []
            })
          : []
      })
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    return Response.json({
      items,
      summary: {
        total: items.length,
        errors: items.filter((item) => item.severity === 'error').length,
        warnings: items.filter((item) => item.severity === 'warning').length,
        unread: items.filter((item) => item.unread).length,
      },
      ...meta,
    })
  }
  if (source.pathname === '/api/search') {
    const results = values.flatMap(({ backend, value }) => {
      const payload = record(value)
      return Array.isArray(payload?.results)
        ? payload.results.flatMap((item) => {
            const entry = record(item)
            return entry ? [{ ...entry, id: `${backend.id}~${String(entry.id || '')}`, to: federatedDestination(entry.to, backend) }] : []
          })
        : []
    })
    return Response.json({ results: results.slice(0, 40), ...meta })
  }
  const notifications: Record<string, unknown>[] = values
    .flatMap(({ backend, value }) => {
      const payload = record(value)
      return Array.isArray(payload?.notifications)
        ? payload.notifications.flatMap((item) => {
            const entry = record(item)
            if (!entry) return []
            return [
              {
                ...entry,
                id: federatedId(backend, entry.id),
                job_id: entry.job_id == null ? null : federatedId(backend, entry.job_id),
                backend_id: backend.id,
                backend_name: backend.label,
              } as Record<string, unknown>,
            ]
          })
        : []
    })
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
  return Response.json({ notifications, unread_count: notifications.filter((item) => !item.read_at).length, ...meta })
}

async function federatedMutation(request: Request, source: URL, identity: ClientIdentity, merge: (values: unknown[]) => unknown) {
  const federation = await federatedValues(request, source, identity)
  if (!federation)
    return Response.json({ error: 'The operation failed on every paired server', backends: publicBackends() }, { status: 502 })
  const payload = record(merge(federation.values.map(({ value }) => value))) || {}
  return Response.json(
    {
      ...payload,
      federation: { connected: federation.values.length, total: activeBackends().length, failures: federation.failures },
    },
    { status: federation.failures.length ? 207 : 200 },
  )
}

function pairedRequestContext(request: Request): RequestBackendContext {
  const requestedServers = requestPairedServers(request).flatMap((server) => {
    if (server.sessionToken) return [server]
    const sessionToken = browserCredential(request, server.credentialId)
    return sessionToken ? [{ ...server, sessionToken }] : []
  })
  const usedIds = new Set(configuredBackends.map(({ id }) => id))
  const usedNamespaces = new Set(configuredBackends.map(({ namespace }) => namespace))
  const pairedServers = requestedServers.filter((server) => {
    if (usedIds.has(server.id) || usedNamespaces.has(server.namespace) || configuredBackends.some(({ url }) => url === server.serviceUrl))
      return false
    usedIds.add(server.id)
    usedNamespaces.add(server.namespace)
    return true
  })
  const paired = new Map(pairedServers.map((server) => [server.id, server]))
  for (const backend of configuredBackends) {
    const matchingServer = requestedServers.find((server) => server.serviceUrl === backend.url)
    if (matchingServer) paired.set(backend.id, matchingServer)
  }
  const backends = resolveApiBackendInputs([
    ...configuredBackends.map(({ id, label, url, namespace }) => ({ id, label, url, namespace })),
    ...pairedServers.map((server) => ({ id: server.id, label: server.name, url: server.serviceUrl, namespace: server.namespace })),
  ])
  const runtime = createRequestRuntimeState(request, backends, paired)
  return {
    backends,
    paired,
    ...runtime,
    outbound: pairedServers.length
      ? new OutboundRequestPolicy({ allowedOrigins: pairedServers.map(({ serviceUrl }) => serviceUrl) })
      : null,
  }
}

export async function proxyApiRequest({ request }: { request: Request }) {
  const pairedHeader = request.headers.get(browserPairingHeader)
  if (pairedHeader && pairedHeader.length > 24_000) {
    return Response.json({ error: 'Too many paired servers for one browser request; remove an unused connection' }, { status: 431 })
  }
  const context = pairedRequestContext(request)
  return backendContext.run(context, async () => {
    try {
      return await proxyApiRequestInContext({ request })
    } finally {
      await context.outbound?.dispose()
    }
  })
}

import { createHash, randomUUID } from 'node:crypto'
import type { ApiBackend } from './api-backend'
import type { BrowserPairedServer } from './browser-pairing'
import type { ReadModelResponse } from './dashboard-cache-model'
import type { BackendStatus } from './federated-backend'

export type BackendRuntime = BackendStatus & {
  snapshot: ReadModelResponse | null
}

export type FederationRuntime = {
  instanceId: string
  digest: string
  version: number
}

const maximumCachedBackendContexts = 256
const runtimeCache = new Map<string, BackendRuntime>()
const federationCache = new Map<string, FederationRuntime>()

function cachedValue<T>(cache: Map<string, T>, key: string, create: () => T) {
  const existing = cache.get(key)
  if (existing) {
    cache.delete(key)
    cache.set(key, existing)
    return existing
  }
  if (cache.size >= maximumCachedBackendContexts) cache.delete(cache.keys().next().value!)
  const value = create()
  cache.set(key, value)
  return value
}

function requestCredentialIdentity(request: Request) {
  const headers = ['authorization', 'cookie', 'proxy-authorization', 'x-vertexade-local-session']
    .map((name) => `${name}:${request.headers.get(name) || ''}`)
    .join('\n')
  return createHash('sha256').update(headers).digest('base64url')
}

function backendRuntimeIdentity(backend: ApiBackend, paired: BrowserPairedServer | undefined, requestCredential: string) {
  const credential = paired
    ? paired.credentialId ||
      createHash('sha256')
        .update(paired.sessionToken || '')
        .digest('base64url')
    : requestCredential
  return createHash('sha256')
    .update(JSON.stringify([backend.id, backend.label, backend.url, backend.namespace, backend.isDefault, credential]))
    .digest('base64url')
}

function createBackendRuntime(backend: ApiBackend): BackendRuntime {
  return {
    id: backend.id,
    label: backend.label,
    namespace: backend.namespace,
    isDefault: backend.isDefault,
    connected: false,
    lastConnectedAt: null,
    error: null,
    snapshot: null,
  }
}

export function createRequestRuntimeState(request: Request, backends: ApiBackend[], paired: Map<string, BrowserPairedServer>) {
  const requestCredential = requestCredentialIdentity(request)
  const identities = backends.map((backend) => backendRuntimeIdentity(backend, paired.get(backend.id), requestCredential))
  const runtimes = new Map(
    backends.map((backend, index) => [backend.id, cachedValue(runtimeCache, identities[index]!, () => createBackendRuntime(backend))]),
  )
  const federationIdentity = createHash('sha256').update(identities.join('\n')).digest('base64url')
  const federation = cachedValue(federationCache, federationIdentity, () => ({
    instanceId: `federated-${randomUUID()}`,
    digest: '',
    version: 0,
  }))
  return { runtimes, federation }
}

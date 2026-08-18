import { browserPairedServersRequestHeaders } from './browser-paired-servers'

export type BackendDescriptor = {
  id: string
  label: string
  namespace: number
  isDefault: boolean
  connected: boolean
  lastConnectedAt: string | null
  error: string | null
  apiPath: string
  realtime?: boolean
}

export type BackendAttributed = {
  backend_id?: string
  backend_name?: string
  backend_connected?: boolean
  backend_local_id?: number | null
  backend_local_key?: string
}

export const federatedIdSpan = 1_000_000_000
export function resolveBackend(backends: BackendDescriptor[], requested = '') {
  return backends.find((backend) => backend.id === requested) || backends.find((backend) => backend.isDefault) || backends[0] || null
}

export function backendApiPath(path: string, backendId?: string | null) {
  if (!backendId) return path
  const suffix = path.startsWith('/api') ? path.slice(4) : path
  return `/api/backends/${encodeURIComponent(backendId)}${suffix}`
}

export function namespaceBackendId(value: unknown, namespace: number) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id >= 0 && id < federatedIdSpan ? namespace * federatedIdSpan + id : value
}

export function localBackendId(value: unknown): string | number {
  const id = Number(value)
  return Number.isSafeInteger(id) && id >= 0 ? id % federatedIdSpan : String(value ?? '')
}

export function displayBackendId(source: BackendAttributed, value: unknown): string | number {
  return source.backend_local_id ?? localBackendId(value)
}

export function displayBackendKey(source: BackendAttributed, value: unknown) {
  return source.backend_local_key || String(value || '')
}

export async function loadBackendRegistry() {
  const response = await fetch('/api/backends', { headers: { accept: 'application/json', ...browserPairedServersRequestHeaders() } })
  if (!response.ok) throw new Error(`Backend registry failed with HTTP ${response.status}`)
  return (await response.json()) as { backends: BackendDescriptor[] }
}

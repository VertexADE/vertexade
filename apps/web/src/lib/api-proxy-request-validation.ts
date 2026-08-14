import { readRequestBody } from '@vertexade/platform-server/http'
import { browserPairingHeader, readBrowserPairedServers } from './browser-pairing'
import { namespaceFromId } from './federated-backend'

const maxProxyJsonRequestBytes = 100_000

export async function hasMixedBackendBatch(request: Request, pathname: string) {
  if (!['/api/work-items', '/api/work-items/delete-preview'].includes(pathname) || !['POST', 'DELETE'].includes(request.method))
    return false
  if (!request.headers.get('content-type')?.includes('application/json')) return false
  try {
    const input = JSON.parse((await readRequestBody(request.clone(), maxProxyJsonRequestBytes)).toString('utf8')) as Record<string, unknown>
    if (!Array.isArray(input.work_item_ids)) return false
    const namespaces = new Set(input.work_item_ids.map(namespaceFromId).filter((value): value is number => value !== null))
    return namespaces.size > 1
  } catch {
    return false
  }
}

export function requestPairedServers(request: Request) {
  const raw = request.headers.get(browserPairingHeader)
  if (!raw || raw.length > 24_000) return []
  try {
    const serialized = decodeURIComponent(raw)
    return readBrowserPairedServers({ getItem: () => serialized })
  } catch {
    return []
  }
}

export function recordError(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const error = String((value as Record<string, unknown>).error || '').trim()
  return error ? { error } : null
}

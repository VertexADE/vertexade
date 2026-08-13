import type { ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { createPlatformClient, type PlatformClient } from '@vertexade/platform-client'
import { mobileAccessToken } from './mobile-session'

export type MobileBackend = {
  id: string
  label: string
  isDefault: boolean
  serviceUrl?: string
}

export type MobileServerCatalog = MobileBackend & {
  modules: ModuleCatalogEntry[]
  error: string
}

const backendIdPattern = /^[a-z0-9][a-z0-9_-]{0,47}$/i

export function createMobilePlatformClient(serviceUrl: string, backendId?: string): PlatformClient {
  const id = backendId?.trim()
  if (id !== undefined && !backendIdPattern.test(id)) throw new Error('VertexADE backend ID is invalid')
  return createPlatformClient({
    baseUrl: serviceUrl,
    getAccessToken: () => mobileAccessToken(serviceUrl),
    ...(id ? { headers: { 'x-vertexade-backend': id } } : {}),
  })
}

export async function loadMobileServerCatalogs(serviceUrl: string): Promise<MobileServerCatalog[]> {
  const service = createMobilePlatformClient(serviceUrl)
  const payload = await service.request<unknown>('/api/backends')
  const backends = parseBackends(payload)
  const primary = backends.find((backend) => backend.isDefault)
  if (!primary) throw new Error('VertexADE service did not identify its primary server')
  return [{ ...(await loadBackendCatalog(serviceUrl, primary)), serviceUrl }]
}

async function loadBackendCatalog(serviceUrl: string, backend: MobileBackend): Promise<MobileServerCatalog> {
  try {
    const catalog = await createMobilePlatformClient(serviceUrl, backend.id).modules.list()
    return { ...backend, modules: catalog.modules, error: '' }
  } catch (reason) {
    return {
      ...backend,
      modules: [],
      error: reason instanceof Error ? reason.message : 'Could not load this server',
    }
  }
}

function parseBackends(payload: unknown): MobileBackend[] {
  if (!isRecord(payload) || !Array.isArray(payload.backends)) throw new Error('VertexADE service returned an invalid server catalog')
  const backends = payload.backends.map(parseBackend)
  if (!backends.length) throw new Error('VertexADE service has no configured servers')
  const duplicate = backends.find((backend, index) => backends.findIndex((candidate) => candidate.id === backend.id) !== index)
  if (duplicate) throw new Error(`VertexADE service returned duplicate backend ID "${duplicate.id}"`)
  return backends
}

function parseBackend(value: unknown): MobileBackend {
  if (!isRecord(value)) throw new Error('VertexADE service returned an invalid backend')
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  if (!backendIdPattern.test(id) || !label) throw new Error('VertexADE service returned an invalid backend')
  return { id, label, isDefault: value.isDefault === true }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

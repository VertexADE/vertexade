import type { ModuleCatalogEntry } from '@vertexade/platform-contracts'
import type { BackendDescriptor } from '@vertexade/ui/lib/backend-registry'

export type ExtensionCatalogView = 'installed' | 'catalog'

export function extensionAvailableInView(module: ModuleCatalogEntry, view: ExtensionCatalogView) {
  return view === 'catalog' || module.installed
}

export function extensionBackendConnection(
  backend: BackendDescriptor,
  error: string | null,
  connectedAt = new Date().toISOString(),
): BackendDescriptor {
  const connectionError = error === null ? null : error || 'Extension catalog unavailable'
  return {
    ...backend,
    connected: connectionError === null,
    error: connectionError,
    lastConnectedAt: connectionError === null ? connectedAt : backend.lastConnectedAt,
  }
}

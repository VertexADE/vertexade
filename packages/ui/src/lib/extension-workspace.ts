import type { ModuleCatalogEntry } from '@vertexade/platform-contracts'

type WorkspaceModule = Pick<ModuleCatalogEntry, 'id' | 'portable'>

export function extensionWorkspaceRoute(module: WorkspaceModule, backendId?: string): string | null {
  if (!module.portable?.surfaces.length) return null
  const route = `/extensions/${module.id}`
  return backendId ? `${route}?server=${encodeURIComponent(backendId)}` : route
}

import type { ModuleCatalogEntry } from '@vertexade/platform-contracts'

type WorkspaceModule = Pick<ModuleCatalogEntry, 'id' | 'portable'>

export function extensionWorkspaceRoute(module: WorkspaceModule): string | null {
  return module.portable?.surfaces.length ? `/extensions/${module.id}` : null
}

import type { ModuleCatalogEntry } from '@vertexade/platform-contracts'

export type ExtensionCatalogView = 'installed' | 'catalog'

export function extensionAvailableInView(module: ModuleCatalogEntry, view: ExtensionCatalogView) {
  return view === 'catalog' || module.installed
}

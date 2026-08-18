import type { ModuleCatalog, ModuleCatalogEntry } from '@vertexade/platform-contracts'

export type NavigationModule = ModuleCatalogEntry & { backendId?: string }

type CatalogSource = {
  backend: { id: string; isDefault: boolean }
  catalog: ModuleCatalog
}

const lifecyclePriority: Record<ModuleCatalogEntry['lifecycle'], number> = {
  disabled: 0,
  failed: 1,
  'setup-required': 2,
  degraded: 3,
  ready: 4,
}

function modulePriority(module: ModuleCatalogEntry) {
  return module.enabled ? lifecyclePriority[module.lifecycle] : lifecyclePriority.disabled
}

export function unifiedNavigationModules(catalogs: CatalogSource[]): NavigationModule[] {
  const modules = new Map<string, { module: NavigationModule; isDefault: boolean }>()
  for (const { backend, catalog } of catalogs) {
    for (const module of catalog.modules) {
      const candidate = { module: { ...module, backendId: backend.id }, isDefault: backend.isDefault }
      const current = modules.get(module.id)
      const candidatePriority = modulePriority(module)
      const currentPriority = current ? modulePriority(current.module) : -1
      if (
        !current ||
        candidatePriority > currentPriority ||
        (candidatePriority === currentPriority && backend.isDefault && !current.isDefault)
      ) {
        modules.set(module.id, candidate)
      }
    }
  }
  return [...modules.values()].map(({ module }) => module)
}

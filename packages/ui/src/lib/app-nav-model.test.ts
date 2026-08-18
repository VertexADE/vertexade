import { describe, expect, it } from 'vite-plus/test'
import type { ModuleCatalog, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { unifiedNavigationModules } from './app-nav-model'

function module(lifecycle: ModuleCatalogEntry['lifecycle']): ModuleCatalogEntry {
  return {
    id: 'github',
    name: 'GitHub',
    version: '1.0.0',
    platformApi: '1',
    kind: 'source-control',
    installed: true,
    enabled: lifecycle !== 'disabled',
    installation: { origin: 'bundled', removable: false },
    lifecycle,
    contributes: {},
  }
}

function catalog(entry: ModuleCatalogEntry): ModuleCatalog {
  return { platformApi: '1', modules: [entry] }
}

describe('unified navigation modules', () => {
  it('prefers the healthiest server copy regardless of registry order', () => {
    const local = { backend: { id: 'local', isDefault: true }, catalog: catalog(module('disabled')) }
    const remote = { backend: { id: 'remote', isDefault: false }, catalog: catalog(module('ready')) }
    expect(unifiedNavigationModules([local, remote])[0]).toMatchObject({ backendId: 'remote', lifecycle: 'ready' })
    expect(unifiedNavigationModules([remote, local])[0]).toMatchObject({ backendId: 'remote', lifecycle: 'ready' })
  })

  it('uses the default server as the tie-breaker for equally healthy copies', () => {
    const local = { backend: { id: 'local', isDefault: true }, catalog: catalog(module('ready')) }
    const remote = { backend: { id: 'remote', isDefault: false }, catalog: catalog(module('ready')) }
    expect(unifiedNavigationModules([remote, local])[0]).toMatchObject({ backendId: 'local', lifecycle: 'ready' })
  })
})

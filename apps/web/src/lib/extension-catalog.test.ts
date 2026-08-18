import { describe, expect, it } from 'vite-plus/test'
import type { ModuleCatalogEntry } from '@vertexade/platform-contracts'

import type { BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import { extensionAvailableInView, extensionBackendConnection } from './extension-catalog'

function extension(input: Partial<ModuleCatalogEntry> = {}): ModuleCatalogEntry {
  return {
    id: 'linear',
    name: 'Linear',
    description: 'Issue tracking',
    version: '1.0.0',
    platformApi: '1',
    kind: 'connector',
    installed: true,
    enabled: false,
    healthy: true,
    lifecycle: 'disabled',
    installation: { origin: 'bundled', removable: false },
    ...input,
  }
}

describe('extension catalog views', () => {
  it('keeps disabled installed extensions visible so they can be enabled again', () => {
    expect(extensionAvailableInView(extension(), 'installed')).toBe(true)
  })

  it('keeps uninstalled catalog entries out of the installed list', () => {
    const available = extension({ installed: false })

    expect(extensionAvailableInView(available, 'installed')).toBe(false)
    expect(extensionAvailableInView(available, 'catalog')).toBe(true)
  })

  it('uses the catalog request itself as the current server connection result', () => {
    const backend = {
      id: 'studio',
      label: 'Studio',
      namespace: 1,
      isDefault: false,
      connected: false,
      lastConnectedAt: null,
      error: 'Earlier event stream failure',
      apiPath: '/api/backends/studio',
    } satisfies BackendDescriptor

    expect(extensionBackendConnection(backend, null, '2026-08-18T10:00:00.000Z')).toMatchObject({
      connected: true,
      error: null,
      lastConnectedAt: '2026-08-18T10:00:00.000Z',
    })
    expect(extensionBackendConnection(backend, 'Catalog request failed')).toMatchObject({
      connected: false,
      error: 'Catalog request failed',
      lastConnectedAt: null,
    })
  })
})

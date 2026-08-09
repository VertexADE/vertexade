import { describe, expect, it } from 'vite-plus/test'
import type { ModuleCatalogEntry } from '@vertexade/platform-contracts'

import { extensionAvailableInView } from './extension-catalog'

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
})

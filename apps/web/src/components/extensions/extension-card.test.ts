import { describe, expect, it } from 'vite-plus/test'
import type { ModuleCatalogEntry } from '@vertexade/platform-contracts'

import { extensionEnableAction } from './extension-card'

const failedExtension = {
  lifecycle: 'failed',
} as ModuleCatalogEntry

describe('extension enable action', () => {
  it('allows a failed initialization to be retried', () => {
    expect(extensionEnableAction(failedExtension, false)).toEqual({
      disabled: false,
      label: 'Retry enable',
    })
  })

  it('only disables the action while the extension is busy', () => {
    expect(extensionEnableAction(failedExtension, true).disabled).toBe(true)
  })
})

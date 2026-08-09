import { describe, expect, it } from 'vite-plus/test'
import { extensionWorkspaceRoute } from './extension-workspace.ts'

describe('extension workspace routing', () => {
  it('gives portable extensions a host-native route', () => {
    expect(
      extensionWorkspaceRoute({
        id: 'example',
        portable: { surfaces: [{} as never] },
      }),
    ).toBe('/extensions/example')
  })

  it('keeps headless extensions out of workspace navigation', () => {
    expect(extensionWorkspaceRoute({ id: 'example' })).toBeNull()
  })
})

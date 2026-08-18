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

  it('keeps remote extension ownership in the plugin route instead of global UI state', () => {
    expect(extensionWorkspaceRoute({ id: 'example', portable: { surfaces: [{} as never] } }, 'team server')).toBe(
      '/extensions/example?server=team%20server',
    )
  })
})

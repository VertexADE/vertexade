import { describe, expect, it } from 'vite-plus/test'
import { desktopPermissionAllowed } from './desktop-permissions.ts'

const applicationOrigin = 'http://127.0.0.1:4173'

describe('desktopPermissionAllowed', () => {
  it('allows clipboard writes only from the main application frame', () => {
    expect(
      desktopPermissionAllowed(
        { permission: 'clipboard-sanitized-write', requestingUrl: `${applicationOrigin}/work`, isMainFrame: true },
        applicationOrigin,
      ),
    ).toBe(true)
    expect(
      desktopPermissionAllowed(
        { permission: 'clipboard-sanitized-write', requestingUrl: `${applicationOrigin}/work`, isMainFrame: false },
        applicationOrigin,
      ),
    ).toBe(false)
  })

  it('rejects cross-origin clipboard and privileged browser permissions', () => {
    expect(
      desktopPermissionAllowed(
        { permission: 'clipboard-sanitized-write', requestingUrl: 'https://attacker.example/', isMainFrame: true },
        applicationOrigin,
      ),
    ).toBe(false)
    for (const permission of ['clipboard-read', 'geolocation', 'media', 'notifications', 'openExternal']) {
      expect(desktopPermissionAllowed({ permission, requestingUrl: applicationOrigin, isMainFrame: true }, applicationOrigin)).toBe(false)
    }
  })
})

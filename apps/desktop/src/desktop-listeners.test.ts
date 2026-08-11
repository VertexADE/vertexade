import { describe, expect, it } from 'vite-plus/test'
import { localListenerUrl, selectDesktopListeners } from './desktop-listeners.ts'

describe('desktop listeners', () => {
  it('uses ephemeral loopback listeners until settings have been saved', async () => {
    const ports = [5101, 5102]
    const listeners = await selectDesktopListeners(
      {},
      async () => ports.shift() || 0,
      async () => false,
    )

    expect(listeners).toEqual({
      api: { host: '127.0.0.1', port: 5101 },
      web: { host: '127.0.0.1', port: 5102 },
      source: 'default',
    })
  })

  it('loads saved listeners and maps wildcard binds to a local window URL', async () => {
    const listeners = await selectDesktopListeners(
      {},
      async () => 0,
      async () => true,
      async () => ({
        api: { host: '127.0.0.1', port: 4174 },
        web: { host: '0.0.0.0', port: 3773 },
      }),
    )

    expect(localListenerUrl(listeners.web)).toBe('http://127.0.0.1:3773')
    expect(localListenerUrl({ host: '::', port: 3773 })).toBe('http://[::1]:3773')
  })
})

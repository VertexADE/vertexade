import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  browserPairedServersHeaderName,
  browserPairedServersRequestHeaders,
  browserPairedServersStorageKey,
  hasBrowserPairedServers,
} from './browser-paired-servers'

afterEach(() => vi.unstubAllGlobals())

describe('browser-paired server request state', () => {
  it('returns an encoded catalog and reports a non-empty connection list', () => {
    const catalog = JSON.stringify([{ id: 'studio' }])
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key === browserPairedServersStorageKey ? catalog : null) })

    expect(browserPairedServersRequestHeaders()).toEqual({ [browserPairedServersHeaderName]: encodeURIComponent(catalog) })
    expect(hasBrowserPairedServers()).toBe(true)
  })

  it('does not break API requests when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('Storage is blocked', 'SecurityError')
      },
    })

    expect(browserPairedServersRequestHeaders()).toEqual({})
    expect(hasBrowserPairedServers()).toBe(false)
  })

  it('does not start remote polling for an empty or malformed catalog', () => {
    let value = '[]'
    vi.stubGlobal('localStorage', { getItem: () => value })
    expect(hasBrowserPairedServers()).toBe(false)
    value = '{invalid'
    expect(hasBrowserPairedServers()).toBe(false)
  })
})

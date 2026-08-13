import { describe, expect, it } from 'vite-plus/test'
import { parseBrowserPairLink, readBrowserPairedServers, writeBrowserPairedServers } from './browser-pairing'

describe('browser pairing', () => {
  it('parses the same one-time pairing links as mobile', () => {
    expect(parseBrowserPairLink(`https://studio.example/pair#token=${'A'.repeat(32)}`)).toEqual({
      serviceUrl: 'https://studio.example',
      token: 'A'.repeat(32),
    })
  })

  it('keeps only valid independent unexpired sessions', () => {
    const raw = JSON.stringify([
      {
        id: 'studio',
        name: 'Studio',
        namespace: 2,
        serviceUrl: 'https://studio.example',
        sessionToken: 'secret',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      {
        id: 'expired',
        name: 'Old',
        namespace: 3,
        serviceUrl: 'https://old.example',
        sessionToken: 'old',
        expiresAt: '2020-01-01T00:00:00Z',
      },
    ])
    expect(readBrowserPairedServers({ getItem: () => raw })).toEqual([
      {
        id: 'studio',
        name: 'Studio',
        namespace: 2,
        serviceUrl: 'https://studio.example',
        sessionToken: 'secret',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    ])
  })

  it('persists the catalog without expanding linked servers transitively', () => {
    let stored = ''
    const servers = [
      {
        id: 'team',
        name: 'Team',
        namespace: 1,
        serviceUrl: 'https://team.example',
        sessionToken: 'secret',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    ]
    writeBrowserPairedServers(servers, {
      setItem: (_key, value) => {
        stored = value
      },
    })
    expect(JSON.parse(stored)).toEqual(servers)
  })
})

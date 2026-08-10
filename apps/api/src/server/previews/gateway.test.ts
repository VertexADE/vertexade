import { describe, expect, it } from 'vite-plus/test'
import { hostnameBelongsToDomain, previewRequestHeaders, previewResponseHeaders } from './gateway.ts'

describe('hostnameBelongsToDomain', () => {
  it('accepts only wildcard children of the configured domain', () => {
    expect(hostnameBelongsToDomain('api-42.previews.example.com', 'previews.example.com')).toBe(true)
    expect(hostnameBelongsToDomain('previews.example.com', 'previews.example.com')).toBe(false)
    expect(hostnameBelongsToDomain('api-42.other.example.com', 'previews.example.com')).toBe(false)
  })
})

describe('previewRequestHeaders', () => {
  it('strips proxy credentials, hop-by-hop headers, and spoofed forwarding metadata', () => {
    expect(
      previewRequestHeaders({
        headers: {
          authorization: 'Bearer preview-app-token',
          connection: 'keep-alive, x-private-hop',
          cookie: 'preview_session=abc',
          forwarded: 'for=attacker.example',
          host: 'app.previews.example.com:4180',
          'proxy-authorization': 'Basic c2VjcmV0',
          'x-forwarded-for': 'attacker.example',
          'x-private-hop': 'remove-me',
        },
        hostname: 'app.previews.example.com',
        remoteAddress: '192.0.2.4',
      }),
    ).toEqual({
      authorization: 'Bearer preview-app-token',
      cookie: 'preview_session=abc',
      host: 'app.previews.example.com:4180',
      'x-forwarded-for': '192.0.2.4',
      'x-forwarded-host': 'app.previews.example.com:4180',
      'x-forwarded-proto': 'http',
    })
  })

  it('retains only the required hop-by-hop headers for websocket upgrades', () => {
    expect(
      previewRequestHeaders({
        headers: {
          connection: 'Upgrade, x-private-hop',
          host: 'app.previews.example.com',
          'sec-websocket-key': 'key',
          upgrade: 'websocket',
          'x-private-hop': 'remove-me',
        },
        hostname: 'app.previews.example.com',
        remoteAddress: undefined,
        upgrade: true,
      }),
    ).toEqual({
      connection: 'Upgrade',
      host: 'app.previews.example.com',
      'sec-websocket-key': 'key',
      upgrade: 'websocket',
      'x-forwarded-host': 'app.previews.example.com',
      'x-forwarded-proto': 'http',
    })
  })
})

describe('previewResponseHeaders', () => {
  it('strips hop-by-hop response headers and headers named by connection', () => {
    expect(
      previewResponseHeaders({
        connection: 'keep-alive, x-private-hop',
        'content-type': 'text/plain',
        'keep-alive': 'timeout=5',
        'proxy-authenticate': 'Basic',
        'x-private-hop': 'remove-me',
      }),
    ).toEqual({ 'content-type': 'text/plain' })
  })
})

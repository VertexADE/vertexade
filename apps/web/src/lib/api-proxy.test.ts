import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { proxyApiRequest } from './api-proxy'

afterEach(() => vi.unstubAllGlobals())

function captureProxyRequest(request: Request) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetch)
  return proxyApiRequest({ request }).then(() => fetch.mock.calls[0]!)
}

describe('proxyApiRequest', () => {
  it('does not present a same-origin browser request as cross-origin to the API service', async () => {
    const [, init] = await captureProxyRequest(
      new Request('http://127.0.0.1:4173/api/modules', {
        headers: {
          host: 'dashboard.example',
          origin: 'http://dashboard.example',
        },
      }),
    )

    expect(new Headers(init?.headers).has('origin')).toBe(false)
  })

  it('preserves a genuinely cross-origin request for API policy enforcement', async () => {
    const [, init] = await captureProxyRequest(
      new Request('http://127.0.0.1:4173/api/modules', {
        headers: {
          host: 'dashboard.example',
          origin: 'https://external.example',
        },
      }),
    )

    expect(new Headers(init?.headers).get('origin')).toBe('https://external.example')
  })
})

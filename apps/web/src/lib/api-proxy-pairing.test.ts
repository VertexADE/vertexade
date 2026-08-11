import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

function enablePairing(): void {
  vi.stubEnv('VERTEXADE_API_URL', 'http://api.internal')
  vi.stubEnv('VERTEXADE_REQUIRE_PAIRED_CLIENTS', '1')
  vi.stubEnv('VERTEXADE_LOCAL_SESSION_TOKEN', 'desktop-local-secret')
}

describe('paired-client API gateway', () => {
  it('rejects unpaired clients before contacting the API service', async () => {
    enablePairing()
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')

    const response = await proxyApiRequest({ request: new Request('http://desktop.internal/api/backends') })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Pair this device in VertexADE Desktop Settings' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts the desktop credential and never forwards it', async () => {
    enablePairing()
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/settings/linked-servers') return Response.json({ servers: [] })
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')

    const response = await proxyApiRequest({
      request: new Request('http://desktop.internal/api/modules', {
        headers: { 'x-vertexade-local-session': 'desktop-local-secret' },
      }),
    })

    expect(response.status).toBe(200)
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).has('x-vertexade-local-session')).toBe(false)
    }
  })

  it('validates a mobile bearer and strips it before forwarding the request', async () => {
    enablePairing()
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/mobile-pairing/session/validate') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer paired-session')
        return Response.json({ id: 'phone' })
      }
      if (url.pathname === '/api/settings/linked-servers') return Response.json({ servers: [] })
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')

    const response = await proxyApiRequest({
      request: new Request('http://desktop.internal/api/modules', {
        headers: { authorization: 'Bearer paired-session' },
      }),
    })

    expect(response.status).toBe(200)
    const backendCall = fetch.mock.calls.find(([input]) => new URL(String(input)).pathname === '/api/modules')
    expect(backendCall).toBeDefined()
    expect(new Headers(backendCall?.[1]?.headers).has('authorization')).toBe(false)
  })

  it('allows one-time pairing redemption without an existing session', async () => {
    enablePairing()
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/settings/linked-servers') return Response.json({ servers: [] })
      return Response.json(
        { serviceUrl: 'http://desktop.internal', sessionToken: 'session', expiresAt: '2026-09-01T00:00:00Z' },
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')

    const response = await proxyApiRequest({
      request: new Request('http://desktop.internal/api/mobile-pairing/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'one-time-token', deviceName: 'iPhone' }),
      }),
    })

    expect(response.status).toBe(201)
  })
})

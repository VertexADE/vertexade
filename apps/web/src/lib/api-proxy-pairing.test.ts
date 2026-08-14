import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@vertexade/platform-server/outbound-policy', () => ({
  OutboundRequestPolicy: class {
    fetch = (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args)
    dispose = async () => undefined
  },
}))

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
    await expect(response.json()).resolves.toEqual({ error: 'Pair this browser with this VertexADE server in Settings' })
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

  it('allows a browser to redeem its first independent server pairing', async () => {
    enablePairing()
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ serviceUrl: 'https://studio.internal', sessionToken: 'session', expiresAt: '2099-09-01T00:00:00Z' }, { status: 201 }),
    )
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')

    const response = await proxyApiRequest({
      request: new Request('http://desktop.internal/api/browser-pairing/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pairUrl: `https://studio.internal/pair#token=${'A'.repeat(32)}`,
          deviceName: 'VertexADE Web',
        }),
      }),
    })

    expect(response.status).toBe(201)
    const payload = await response.json()
    expect(payload).not.toHaveProperty('sessionToken')
    expect(payload.credentialId).toMatch(/^[a-f0-9]{24}$/)
    expect(payload.namespace).toBe(1)
    expect(response.headers.get('set-cookie')).toContain(`vertexade_pair_${payload.credentialId}=`)
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://studio.internal/api/mobile-pairing/redeem'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('allocates a namespace that does not collide with configured or browser-paired servers', async () => {
    vi.stubEnv(
      'VERTEXADE_API_URLS',
      JSON.stringify([
        { id: 'local', label: 'Local', url: 'http://api.internal', namespace: 0 },
        { id: 'team', label: 'Team', url: 'http://team.internal', namespace: 1 },
      ]),
    )
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ serviceUrl: 'https://new.internal', sessionToken: 'session', expiresAt: '2099-09-01T00:00:00Z' }, { status: 201 }),
    )
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')
    const paired = encodeURIComponent(
      JSON.stringify([
        {
          id: 'studio',
          name: 'Studio',
          namespace: 2,
          serviceUrl: 'https://studio.internal',
          sessionToken: 'studio-session',
          expiresAt: '2099-09-01T00:00:00Z',
        },
      ]),
    )

    const response = await proxyApiRequest({
      request: new Request('http://desktop.internal/api/browser-pairing/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-vertexade-paired-servers': paired },
        body: JSON.stringify({ pairUrl: `https://new.internal/pair#token=${'A'.repeat(32)}` }),
      }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ namespace: 3 }))
  })

  it('migrates legacy browser tokens into cookies and clears revoked credentials', async () => {
    enablePairing()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (input) => {
        if (new URL(String(input)).pathname === '/api/mobile-pairing/session/validate') return Response.json({ id: 'browser' })
        return Response.json({ ok: true })
      }),
    )
    const { proxyApiRequest } = await import('./api-proxy')
    const paired = encodeURIComponent(
      JSON.stringify([
        {
          id: 'local',
          name: 'Local',
          namespace: 1,
          serviceUrl: 'http://api.internal',
          sessionToken: 'legacy-session',
          expiresAt: '2099-09-01T00:00:00Z',
        },
      ]),
    )
    const migrated = await proxyApiRequest({
      request: new Request('http://desktop.internal/api/browser-pairing/migrate', {
        method: 'POST',
        headers: { 'x-vertexade-paired-servers': paired },
      }),
    })
    const payload = await migrated.json()
    expect(payload.credentials).toEqual([expect.objectContaining({ serviceUrl: 'http://api.internal' })])
    expect(migrated.headers.get('set-cookie')).toContain(`vertexade_pair_${payload.credentials[0].credentialId}=`)

    const revoked = await proxyApiRequest({
      request: new Request(`http://desktop.internal/api/browser-pairing/credential?id=${payload.credentials[0].credentialId}`, {
        method: 'DELETE',
        headers: { 'x-vertexade-local-session': 'desktop-local-secret' },
      }),
    })
    expect(revoked.status).toBe(200)
    expect(revoked.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('issues an http-only browser session for the local server and accepts it for realtime requests', async () => {
    enablePairing()
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/mobile-pairing/redeem') {
        return Response.json(
          { serviceUrl: 'http://api.internal', sessionToken: 'browser-session', expiresAt: '2099-09-01T00:00:00Z' },
          { status: 201 },
        )
      }
      if (url.pathname === '/api/mobile-pairing/session/validate') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer browser-session')
        return Response.json({ id: 'browser' })
      }
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')
    const redemption = await proxyApiRequest({
      request: new Request('http://desktop.internal/api/browser-pairing/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairUrl: `http://api.internal/pair#token=${'A'.repeat(32)}` }),
      }),
    })
    const cookie = redemption.headers.get('set-cookie')

    expect(cookie).toContain('vertexade_browser_session=')
    expect(cookie).toContain('HttpOnly')
    const browserSession = cookie!.match(/vertexade_browser_session=[^;,]+/)?.[0]
    expect(browserSession).toBeDefined()
    const response = await proxyApiRequest({
      request: new Request('http://desktop.internal/api/events', { headers: { cookie: browserSession! } }),
    })
    expect(response.status).toBe(200)
  })
})

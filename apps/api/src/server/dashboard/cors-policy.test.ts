import { describe, expect, it } from 'vite-plus/test'
import { CorsConfigurationError, DashboardCorsPolicy, parseCorsAllowedOrigins } from './cors-policy.ts'

const policy = new DashboardCorsPolicy(['https://dashboard.example'])

function request(method = 'GET', headers: Record<string, string> = {}) {
  return new Request('http://api.example/api/test', { method, headers })
}

describe('dashboard CORS policy', () => {
  it('allows only configured exact origins and merges Vary', () => {
    const response = policy.after(
      request('GET', { origin: 'https://dashboard.example' }),
      Response.json({ ok: true }, { headers: { vary: 'Accept-Encoding' } }),
    )
    expect(response.headers.get('access-control-allow-origin')).toBe('https://dashboard.example')
    expect(response.headers.get('vary')).toBe('Accept-Encoding, Origin')
    expect(policy.before(request('GET', { origin: 'https://attacker.example' }))?.status).toBe(403)
    expect(policy.before(request('GET', { origin: 'null' }))?.status).toBe(403)
  })

  it('leaves same-origin proxy, CLI, and native requests unchanged', () => {
    const response = Response.json({ ok: true })
    expect(policy.before(request())).toBeNull()
    expect(policy.after(request(), response)).toBe(response)
  })

  it('returns a restrictive preflight for an allowed origin', () => {
    const response = policy.before(
      request('OPTIONS', {
        origin: 'https://dashboard.example',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'Authorization, Content-Type',
      }),
    )!
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://dashboard.example')
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*')
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization')
    expect(response.headers.get('access-control-max-age')).toBe('600')
  })

  it('rejects invalid preflight methods and headers before routing', () => {
    expect(
      policy.before(
        request('OPTIONS', {
          origin: 'https://dashboard.example',
          'access-control-request-method': 'CONNECT',
        }),
      )?.status,
    ).toBe(403)
    expect(
      policy.before(
        request('OPTIONS', {
          origin: 'https://dashboard.example',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'x-untrusted-control',
        }),
      )?.status,
    ).toBe(403)
    expect(policy.before(request('OPTIONS'))?.status).toBe(403)
  })

  it('normalizes default ports and rejects broad configuration', () => {
    expect([...parseCorsAllowedOrigins('HTTPS://DASHBOARD.EXAMPLE:443, http://localhost:4173')]).toEqual([
      'https://dashboard.example',
      'http://localhost:4173',
    ])
    expect(() => parseCorsAllowedOrigins('*')).toThrow(CorsConfigurationError)
    expect(() => parseCorsAllowedOrigins('null')).toThrow(CorsConfigurationError)
    expect(() => parseCorsAllowedOrigins('https://example.com/path')).toThrow(CorsConfigurationError)
  })
})

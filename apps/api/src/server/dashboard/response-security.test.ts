import { describe, expect, it } from 'vite-plus/test'
import { secureDashboardResponse } from './response-security.ts'

describe('secureDashboardResponse', () => {
  it('applies the API security policy at the outer response boundary', async () => {
    const response = secureDashboardResponse(Response.json({ ok: true }))
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(response.headers.get('permissions-policy')).toBe('camera=(), geolocation=(), microphone=()')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('preserves stricter route-specific policy and cache headers', () => {
    const response = secureDashboardResponse(
      new Response('<svg/>', {
        headers: {
          'cache-control': 'public, max-age=3600',
          'content-security-policy': "default-src 'none'; sandbox",
        },
      }),
    )
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
  })
})

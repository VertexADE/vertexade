import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createServer } from 'node:http'
import { OutboundPolicyError, OutboundRequestPolicy, normalizeOutboundUrl, parseOutboundAllowedOrigins } from './outbound-policy.ts'

const policies: OutboundRequestPolicy[] = []
afterEach(async () => {
  await Promise.all(policies.splice(0).map((policy) => policy.dispose()))
})

function policy(addresses: Array<{ address: string; family: 4 | 6 }>, transport = vi.fn(async () => new Response('{}'))) {
  const instance = new OutboundRequestPolicy({ resolver: async () => addresses, transport })
  policies.push(instance)
  return { instance, transport }
}

describe('outbound request policy', () => {
  it.each([
    'http://127.0.0.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://017700000001',
    'http://10.1.2.3',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.1',
    'http://[::1]',
    'http://[fc00::1]',
    'http://[::ffff:127.0.0.1]',
  ])('blocks non-public destination %s before transport', async (url) => {
    const normalized = normalizeOutboundUrl(url)
    const family = normalized.hostname.startsWith('[') ? 6 : 4
    const address = normalized.hostname.replace(/^\[|\]$/g, '')
    const { instance, transport } = policy([{ address, family } as any])
    await expect(instance.fetch(url)).rejects.toBeInstanceOf(OutboundPolicyError)
    expect(transport).not.toHaveBeenCalled()
  })

  it('rejects mixed public and private DNS answers', async () => {
    const { instance, transport } = policy([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ])
    await expect(instance.fetch('https://example.com')).rejects.toThrow('non-public')
    expect(transport).not.toHaveBeenCalled()
  })

  it('allows an exact configured private origin but not a near match', async () => {
    const transport = vi.fn(async () => new Response('{}'))
    const instance = new OutboundRequestPolicy({
      allowedOrigins: ['http://sonar.internal:9000'],
      resolver: async () => [{ address: '10.0.0.9', family: 4 }],
      transport,
    })
    policies.push(instance)
    await expect(instance.fetch('http://sonar.internal:9000/api')).resolves.toBeInstanceOf(Response)
    await expect(instance.fetch('http://sonar.internal:9001/api')).rejects.toThrow('non-public')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('revalidates DNS on every request and fails closed after a rebinding change', async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    const transport = vi.fn(async () => new Response('{}'))
    const instance = new OutboundRequestPolicy({ resolver, transport })
    policies.push(instance)
    await instance.fetch('https://example.com')
    await expect(instance.fetch('https://example.com')).rejects.toThrow('non-public')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('revalidates redirects and blocks a credential-bearing origin change', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://other.example/next' } }))
    const instance = new OutboundRequestPolicy({
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      transport,
    })
    policies.push(instance)
    await expect(instance.fetch('https://example.com/start', { headers: { authorization: 'Bearer secret' } })).rejects.toThrow(
      'credentials cannot cross',
    )
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('blocks a redirect that resolves to a private address before the second hop', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://private.example/next' } }))
    const instance = new OutboundRequestPolicy({
      resolver: async (name) => [
        name === 'private.example' ? { address: '127.0.0.1', family: 4 } : { address: '93.184.216.34', family: 4 },
      ],
      transport,
    })
    policies.push(instance)
    await expect(instance.fetch('https://example.com/start')).rejects.toThrow('non-public')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('follows a same-origin redirect with credentials and a manual transport policy', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: '/next' } }))
      .mockResolvedValueOnce(new Response('{"ok":true}'))
    const instance = new OutboundRequestPolicy({
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      transport,
    })
    policies.push(instance)
    await expect(instance.fetch('https://example.com/start', { headers: { authorization: 'Bearer secret' } })).resolves.toBeInstanceOf(
      Response,
    )
    expect(transport).toHaveBeenCalledTimes(2)
    const second = transport.mock.calls[1]!
    expect(second[0].toString()).toBe('https://example.com/next')
    expect(new Headers(second[1]?.headers).get('authorization')).toBe('Bearer secret')
    expect(second[1]?.redirect).toBe('manual')
  })

  it('rejects unsafe URL syntax and allowlist entries', () => {
    expect(() => normalizeOutboundUrl('file:///tmp/socket')).toThrow('HTTP or HTTPS')
    expect(() => normalizeOutboundUrl('https://user:secret@example.com')).toThrow('credentials')
    expect(() => normalizeOutboundUrl('https://example.com/#fragment')).toThrow('fragment')
    expect(() => parseOutboundAllowedOrigins('https://*.example.com')).toThrow('wildcards')
    expect(() => parseOutboundAllowedOrigins('https://example.com/path')).toThrow('path')
    expect([...parseOutboundAllowedOrigins('HTTPS://EXAMPLE.COM:443, https://example.com')]).toEqual(['https://example.com'])
  })

  it('pins the validated address into the real transport lookup', async () => {
    const server = createServer((_request, response) => response.end('pinned'))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test server')
    const origin = `http://public-name.invalid:${address.port}`
    const resolver = vi.fn(async () => [{ address: '127.0.0.1', family: 4 as const }])
    const instance = new OutboundRequestPolicy({ allowedOrigins: [origin], resolver })
    policies.push(instance)
    try {
      const response = await instance.fetch(`${origin}/probe`)
      await expect(response.text()).resolves.toBe('pinned')
      expect(resolver).toHaveBeenCalledWith('public-name.invalid')
    } finally {
      await instance.dispose()
      policies.splice(policies.indexOf(instance), 1)
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })
})

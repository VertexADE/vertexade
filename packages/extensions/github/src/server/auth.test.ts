import { generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vite-plus/test'
import { createGitHubAppJwt, createGitHubInstallationToken } from './auth.ts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const credentials = {
  appId: '123',
  installationId: '456',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
}

describe('GitHub App authentication', () => {
  it('creates a signed, short-lived app JWT', () => {
    const jwt = createGitHubAppJwt(credentials, 1_700_000_000_000)
    const [header, payload, signature] = jwt.split('.')
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    })
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({
      iss: '123',
      iat: 1_699_999_940,
      exp: 1_700_000_540,
    })
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
  })

  it('exchanges the JWT for an installation token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'installation-token', expires_at: '2030-01-01T00:00:00Z' }), {
        status: 201,
      }),
    )
    await expect(createGitHubInstallationToken(credentials, fetchImpl)).resolves.toEqual({
      token: 'installation-token',
      expiresAt: '2030-01-01T00:00:00Z',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/app/installations/456/access_tokens',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('times out when the connection does not produce headers', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted', { cause: init.signal?.reason })), { once: true })
        }),
    )

    await expect(createGitHubInstallationToken(credentials, fetchImpl, { timeoutMs: 20 })).rejects.toThrow(/timed out/i)
  })

  it('times out and cancels a stalled response body', async () => {
    let cancelled = false
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull() {},
          cancel() {
            cancelled = true
          },
        }),
        { status: 201 },
      ),
    )

    await expect(createGitHubInstallationToken(credentials, fetchImpl, { timeoutMs: 20 })).rejects.toThrow(/timed out/i)
    expect(cancelled).toBe(true)
  })

  it('rejects declared and streamed oversized token responses', async () => {
    const declared = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 201,
        headers: { 'content-length': '101' },
      }),
    )
    const streamed = vi.fn().mockResolvedValue(new Response('x'.repeat(101), { status: 201 }))

    await expect(createGitHubInstallationToken(credentials, declared, { maxResponseBytes: 100 })).rejects.toThrow(
      'GitHub App authentication response is too large',
    )
    await expect(createGitHubInstallationToken(credentials, streamed, { maxResponseBytes: 100 })).rejects.toThrow(
      'GitHub App authentication response is too large',
    )
  })

  it('rejects invalid JSON and incomplete token responses', async () => {
    await expect(createGitHubInstallationToken(credentials, vi.fn().mockResolvedValue(new Response('{', { status: 201 })))).rejects.toThrow(
      'GitHub App authentication returned invalid JSON',
    )
    await expect(
      createGitHubInstallationToken(credentials, vi.fn().mockResolvedValue(Response.json({ token: 'missing-expiry' }, { status: 201 }))),
    ).rejects.toThrow('GitHub App authentication returned an invalid token response')
  })

  it('preserves caller cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ token: 'ignored', expires_at: '2030-01-01' }, { status: 201 }))

    await expect(createGitHubInstallationToken(credentials, fetchImpl, { signal: controller.signal })).rejects.toThrow(
      'GitHub App authentication was cancelled',
    )
  })
})

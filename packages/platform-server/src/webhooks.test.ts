import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vite-plus/test'
import { requireBasicAuthWebhookCredentials, requireFreshWebhookTimestamp, requireHmacSha256WebhookSignature } from './webhooks.ts'

describe('webhook verification', () => {
  it('accepts an exact HMAC-SHA256 signature for the raw body', () => {
    const body = Buffer.from('{"action":"update"}')
    const secret = 'signing-secret'
    const signature = createHmac('sha256', secret).update(body).digest('hex')

    expect(() => requireHmacSha256WebhookSignature({ body, secret, signature })).not.toThrow()
  })

  it('rejects missing, malformed, and mismatched signatures', () => {
    const body = Buffer.from('{}')
    expect(() => requireHmacSha256WebhookSignature({ body, secret: '', signature: '' })).toThrow(expect.objectContaining({ status: 503 }))
    expect(() => requireHmacSha256WebhookSignature({ body, secret: 'secret', signature: 'not-hex' })).toThrow(
      expect.objectContaining({ status: 401 }),
    )
    expect(() => requireHmacSha256WebhookSignature({ body, secret: 'secret', signature: '0'.repeat(64) })).toThrow(
      expect.objectContaining({ status: 401 }),
    )
  })

  it('supports prefixed signatures and binary signing keys', () => {
    const body = Buffer.from('{"base":{"id":"app-1"}}')
    const secret = Buffer.from('binary-secret')
    const signature = `hmac-sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

    expect(() =>
      requireHmacSha256WebhookSignature({
        body,
        secret,
        signature,
        signaturePrefix: 'hmac-sha256=',
      }),
    ).not.toThrow()
    expect(() =>
      requireHmacSha256WebhookSignature({
        body,
        secret,
        signature: signature.replace('hmac-sha256=', 'sha256='),
        signaturePrefix: 'hmac-sha256=',
      }),
    ).toThrow(expect.objectContaining({ status: 401 }))
  })

  it('verifies dedicated Basic Auth webhook credentials', () => {
    const authorization = `Basic ${Buffer.from('vertexade:webhook-secret').toString('base64')}`
    expect(() =>
      requireBasicAuthWebhookCredentials({
        authorization,
        username: 'vertexade',
        password: 'webhook-secret',
      }),
    ).not.toThrow()
    expect(() =>
      requireBasicAuthWebhookCredentials({
        authorization,
        username: 'vertexade',
        password: 'different-secret',
      }),
    ).toThrow(expect.objectContaining({ status: 401 }))
    expect(() =>
      requireBasicAuthWebhookCredentials({
        authorization: '',
        username: 'vertexade',
        password: '',
      }),
    ).toThrow(expect.objectContaining({ status: 503 }))
  })

  it('accepts timestamps inside the replay window and rejects stale or invalid values', () => {
    expect(() => requireFreshWebhookTimestamp({ timestamp: 950, now: 1_000, toleranceMs: 100 })).not.toThrow()
    expect(() => requireFreshWebhookTimestamp({ timestamp: 899, now: 1_000, toleranceMs: 100 })).toThrow(
      expect.objectContaining({ status: 401 }),
    )
    expect(() => requireFreshWebhookTimestamp({ timestamp: 'not-a-timestamp', now: 1_000 })).toThrow(
      expect.objectContaining({ status: 401 }),
    )
  })
})

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { ExtensionHostServices } from '@vertexade/platform-contracts'
import { publishExtensionChange } from './extension-data.ts'
import { HttpError, isRecord } from './http.ts'

type HmacSha256WebhookVerification = {
  body: Uint8Array
  secret: string | Uint8Array
  signature: string | null | undefined
  signaturePrefix?: string
}

type WebhookFreshnessVerification = {
  timestamp: unknown
  now?: number
  toleranceMs?: number
}

export type ExtensionWebhookDependencies<TConfig, TReason extends string> = {
  config(): TConfig
  onChange(reason: TReason): void
}

export function parseJsonWebhookBody(body: Uint8Array) {
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(body).toString('utf8'))
  } catch {
    throw new HttpError('Webhook body must contain valid JSON', 400)
  }
  if (!isRecord(payload)) throw new HttpError('Webhook body must be a JSON object', 400)
  return payload
}

export function acknowledgeWebhookChange<TReason extends string>(
  change: { reason: TReason } | null,
  dependencies: Pick<ExtensionWebhookDependencies<unknown, TReason>, 'onChange'>,
) {
  if (!change) return Response.json({ accepted: true, refreshed: false })
  dependencies.onChange(change.reason)
  return Response.json({ accepted: true, refreshed: true })
}

export function extensionWebhookDependencies<TConfig, TReason extends string>(
  host: Pick<ExtensionHostServices, 'cache' | 'events'>,
  config: () => TConfig,
): ExtensionWebhookDependencies<TConfig, TReason> {
  return {
    config,
    onChange: (reason) => publishExtensionChange(host, reason),
  }
}

export function requireHmacSha256WebhookSignature({ body, secret, signature, signaturePrefix = '' }: HmacSha256WebhookVerification) {
  if (!secret || (typeof secret === 'string' && !secret.length) || (secret instanceof Uint8Array && !secret.byteLength)) {
    throw new HttpError('Webhook signing secret is not configured', 503)
  }
  const rawSignature = String(signature || '').trim()
  if (signaturePrefix && !rawSignature.startsWith(signaturePrefix)) {
    throw new HttpError('Invalid webhook signature', 401)
  }
  const supplied = signaturePrefix ? rawSignature.slice(signaturePrefix.length) : rawSignature
  const expected = createHmac('sha256', secret).update(body).digest()
  if (!/^[a-f0-9]{64}$/i.test(supplied)) throw new HttpError('Invalid webhook signature', 401)
  const received = Buffer.from(supplied, 'hex')
  if (received.byteLength !== expected.byteLength || !timingSafeEqual(expected, received)) {
    throw new HttpError('Invalid webhook signature', 401)
  }
}

function secureTextEqual(left: string, right: string) {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

export function requireBasicAuthWebhookCredentials({
  authorization,
  username,
  password,
}: {
  authorization: string | null | undefined
  username: string
  password: string
}) {
  if (!password) throw new HttpError('Webhook password is not configured', 503)
  const supplied = String(authorization || '').trim()
  if (!supplied.startsWith('Basic ')) throw new HttpError('Invalid webhook credentials', 401)
  let decoded = ''
  try {
    decoded = Buffer.from(supplied.slice(6), 'base64').toString('utf8')
  } catch {
    throw new HttpError('Invalid webhook credentials', 401)
  }
  const separator = decoded.indexOf(':')
  if (
    separator < 0 ||
    !secureTextEqual(decoded.slice(0, separator), username) ||
    !secureTextEqual(decoded.slice(separator + 1), password)
  ) {
    throw new HttpError('Invalid webhook credentials', 401)
  }
}

export function requireFreshWebhookTimestamp({ timestamp, now = Date.now(), toleranceMs = 60_000 }: WebhookFreshnessVerification) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || Math.abs(now - value) > toleranceMs) {
    throw new HttpError('Webhook timestamp is outside the accepted window', 401)
  }
}

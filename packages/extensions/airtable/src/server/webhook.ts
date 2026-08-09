import { HttpError, isRecord, readRequestBody } from '@vertexade/platform-server/http'
import {
  acknowledgeWebhookChange,
  type ExtensionWebhookDependencies,
  parseJsonWebhookBody,
  requireHmacSha256WebhookSignature,
} from '@vertexade/platform-server/webhooks'
import type { AirtableWebhookRegistration } from './types.ts'

const MAX_AIRTABLE_WEBHOOK_BYTES = 256_000

type AirtableWebhookConfig = {
  baseId: string
  webhook: AirtableWebhookRegistration | null
}

type AirtableWebhookDependencies = ExtensionWebhookDependencies<AirtableWebhookConfig, 'airtable_records_changed'>

function identifier(value: unknown) {
  return isRecord(value) && value.id !== undefined && value.id !== null ? String(value.id) : ''
}

export function matchesAirtableWebhook(payload: Record<string, unknown>, baseId: string, webhookId: string) {
  return identifier(payload.base) === baseId && identifier(payload.webhook) === webhookId
}

export async function handleAirtableWebhook(request: Request, dependencies: AirtableWebhookDependencies) {
  const body = await readRequestBody(request, MAX_AIRTABLE_WEBHOOK_BYTES)
  const config = dependencies.config()
  if (!config.webhook) throw new HttpError('Airtable live sync is not configured', 503)
  let secret: Buffer
  try {
    secret = Buffer.from(config.webhook.macSecretBase64, 'base64')
  } catch {
    throw new HttpError('Airtable webhook signing secret is invalid', 503)
  }
  if (!secret.byteLength) throw new HttpError('Airtable webhook signing secret is invalid', 503)
  requireHmacSha256WebhookSignature({
    body,
    secret,
    signature: request.headers.get('x-airtable-content-mac'),
    signaturePrefix: 'hmac-sha256=',
  })
  const payload = parseJsonWebhookBody(body)
  if (!matchesAirtableWebhook(payload, config.baseId, config.webhook.id)) {
    return Response.json({ accepted: true, refreshed: false })
  }
  return acknowledgeWebhookChange({ reason: 'airtable_records_changed' as const }, dependencies)
}

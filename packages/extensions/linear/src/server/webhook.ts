import { isRecord, readRequestBody } from '@vertexade/platform-server/http'
import {
  acknowledgeWebhookChange,
  type ExtensionWebhookDependencies,
  parseJsonWebhookBody,
  requireFreshWebhookTimestamp,
  requireHmacSha256WebhookSignature,
} from '@vertexade/platform-server/webhooks'

const MAX_LINEAR_WEBHOOK_BYTES = 256_000

type LinearWebhookConfig = {
  webhookSecret: string
  teamIds: string[]
}

export type LinearWebhookChange = {
  reason: 'linear_issue_created' | 'linear_issue_updated' | 'linear_issue_deleted' | 'linear_issue_changed'
  issueId: string | null
  deliveryId: string | null
}

type LinearWebhookDependencies = ExtensionWebhookDependencies<LinearWebhookConfig, LinearWebhookChange['reason']> & {
  now?: () => number
}

function issueTeamIds(payload: Record<string, unknown>) {
  const data = isRecord(payload.data) ? payload.data : {}
  const previous = isRecord(payload.updatedFrom) ? payload.updatedFrom : {}
  return [
    data.teamId,
    isRecord(data.team) ? data.team.id : undefined,
    previous.teamId,
    isRecord(previous.team) ? previous.team.id : undefined,
  ]
    .filter((value): value is NonNullable<typeof value> => value !== undefined && value !== null)
    .map(String)
}

function issueReason(action: unknown): LinearWebhookChange['reason'] {
  if (action === 'create') return 'linear_issue_created'
  if (action === 'update') return 'linear_issue_updated'
  if (action === 'remove') return 'linear_issue_deleted'
  return 'linear_issue_changed'
}

export function normalizeLinearWebhook(
  payload: Record<string, unknown>,
  selectedTeamIds: string[],
  deliveryId: string | null,
): LinearWebhookChange | null {
  if (payload.type !== 'Issue') return null
  const teamIds = issueTeamIds(payload)
  if (teamIds.length && !teamIds.some((teamId) => selectedTeamIds.includes(teamId))) return null
  const data = isRecord(payload.data) ? payload.data : {}
  return {
    reason: issueReason(payload.action),
    issueId: data.id ? String(data.id) : null,
    deliveryId,
  }
}

export async function handleLinearWebhook(request: Request, dependencies: LinearWebhookDependencies) {
  const body = await readRequestBody(request, MAX_LINEAR_WEBHOOK_BYTES)
  const config = dependencies.config()
  requireHmacSha256WebhookSignature({
    body,
    secret: config.webhookSecret,
    signature: request.headers.get('linear-signature'),
  })
  const payload = parseJsonWebhookBody(body)
  requireFreshWebhookTimestamp({
    timestamp: payload.webhookTimestamp,
    now: dependencies.now?.() ?? Date.now(),
  })
  const change = normalizeLinearWebhook(payload, config.teamIds, request.headers.get('linear-delivery'))
  return acknowledgeWebhookChange(change, dependencies)
}

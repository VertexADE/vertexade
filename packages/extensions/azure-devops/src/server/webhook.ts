import { isRecord, readRequestBody } from '@vertexade/platform-server/http'
import {
  acknowledgeWebhookChange,
  type ExtensionWebhookDependencies,
  parseJsonWebhookBody,
  requireBasicAuthWebhookCredentials,
} from '@vertexade/platform-server/webhooks'

const MAX_AZURE_WEBHOOK_BYTES = 512_000
export const AZURE_WEBHOOK_USERNAME = 'vertexade'

type AzureWebhookConfig = {
  project: string
  webhookSecret: string
}

export type AzureWebhookChange = {
  reason: 'azure_work_item_created' | 'azure_work_item_updated' | 'azure_work_item_deleted' | 'azure_work_item_restored'
  workItemId: string | null
  deliveryId: string | null
}

type AzureWebhookDependencies = ExtensionWebhookDependencies<AzureWebhookConfig, AzureWebhookChange['reason']>

const EVENT_REASONS: Record<string, AzureWebhookChange['reason']> = {
  'workitem.created': 'azure_work_item_created',
  'workitem.updated': 'azure_work_item_updated',
  'workitem.deleted': 'azure_work_item_deleted',
  'workitem.restored': 'azure_work_item_restored',
}

function textAt(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return value === undefined || value === null ? '' : String(value)
}

function projectNames(payload: Record<string, unknown>) {
  const resource = isRecord(payload.resource) ? payload.resource : {}
  const fields = isRecord(resource.fields) ? resource.fields : {}
  const revision = isRecord(resource.revision) ? resource.revision : {}
  const revisionFields = isRecord(revision.fields) ? revision.fields : {}
  const containers = isRecord(payload.resourceContainers) ? payload.resourceContainers : {}
  const project = isRecord(containers.project) ? containers.project : {}
  return [textAt(fields, 'System.TeamProject'), textAt(revisionFields, 'System.TeamProject'), textAt(project, 'name')].filter(Boolean)
}

function reasonFor(eventType: string): AzureWebhookChange['reason'] | null {
  return EVENT_REASONS[eventType] ?? null
}

export function normalizeAzureWebhook(payload: Record<string, unknown>, configuredProject: string): AzureWebhookChange | null {
  const eventType = String(payload.eventType || '')
  const reason = reasonFor(eventType)
  if (!reason) return null
  const projects = projectNames(payload)
  if (projects.length && !projects.some((project) => project.localeCompare(configuredProject, undefined, { sensitivity: 'accent' }) === 0))
    return null
  const resource = isRecord(payload.resource) ? payload.resource : {}
  const revision = isRecord(resource.revision) ? resource.revision : {}
  const workItemId = resource.workItemId ?? resource.id ?? revision.id
  return {
    reason,
    workItemId: workItemId === undefined || workItemId === null ? null : String(workItemId),
    deliveryId: payload.id === undefined || payload.id === null ? null : String(payload.id),
  }
}

export async function handleAzureWebhook(request: Request, dependencies: AzureWebhookDependencies) {
  const body = await readRequestBody(request, MAX_AZURE_WEBHOOK_BYTES)
  const config = dependencies.config()
  requireBasicAuthWebhookCredentials({
    authorization: request.headers.get('authorization'),
    username: AZURE_WEBHOOK_USERNAME,
    password: config.webhookSecret,
  })
  const change = normalizeAzureWebhook(parseJsonWebhookBody(body), config.project)
  return acknowledgeWebhookChange(change, dependencies)
}

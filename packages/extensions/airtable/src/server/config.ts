import type { ExtensionHostServices, RecordsProvider } from '@vertexade/platform-contracts'
import { Effect, Either } from 'effect'
import { type ApiFailureFallback, type ApiEffect, runApiEffect, tryApi, tryApiPromise } from '@vertexade/platform-server/effect'
import { publishExtensionChange } from '@vertexade/platform-server/extension-data'
import { HttpError, isRecord, readJsonObject } from '@vertexade/platform-server/http'
import type { AirtableClient } from './client.ts'
import type { AirtableCardField, AirtableConfig, AirtableWebhookRegistration, ConfiguredAirtableConfig } from './types.ts'

const AIRTABLE_WEBHOOK_PATH = '/api/extensions/airtable/webhook'
const AIRTABLE_CARD_STYLES = new Set(['text', 'badge', 'date', 'person', 'links'])
const EMPTY_CONFIG: AirtableConfig = {
  token: '',
  baseId: '',
  tableId: '',
  view: '',
  titleField: '',
  cardFields: [],
  webhook: null,
}

type AirtableProvider = RecordsProvider<AirtableConfig, AirtableClient>

function optionalText(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function canonicalCardField(value: unknown): AirtableCardField | null {
  if (!isRecord(value)) return null
  const field = optionalText(value.field).trim()
  if (!field) return null
  return {
    field,
    style: AIRTABLE_CARD_STYLES.has(String(value.style)) ? String(value.style) : 'text',
    resolve: Boolean(value.resolve),
    placement: value.placement === 'detail' ? 'detail' : 'card',
  }
}

function canonicalCardFields(value: unknown): AirtableCardField[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const field = canonicalCardField(item)
    return field ? [field] : []
  })
}

function migratedWebhook(value: unknown): AirtableWebhookRegistration | null {
  if (!isRecord(value) || !isRecord(value.webhook)) return null
  const webhook = value.webhook
  return {
    id: optionalText(webhook.id),
    macSecretBase64: optionalText(webhook.macSecretBase64),
    publicUrl: optionalText(webhook.publicUrl),
    notificationUrl: optionalText(webhook.notificationUrl),
    expirationTime: webhook.expirationTime ? String(webhook.expirationTime) : null,
  }
}

function migratedCardFields(value: Record<string, unknown>) {
  const legacyFields = Array.isArray(value.visibleFields) ? value.visibleFields.map(String) : []
  const legacyResolve = new Set(Array.isArray(value.resolveFields) ? value.resolveFields.map(String) : [])
  const cardFields =
    value.cardFields ??
    legacyFields.map((field) => ({
      field,
      style: legacyResolve.has(field) ? 'links' : 'text',
      resolve: legacyResolve.has(field),
    }))
  return canonicalCardFields(cardFields)
}

export function migrateAirtableConfig(value: unknown): AirtableConfig {
  const input = isRecord(value) ? value : {}
  const fields = isRecord(input.fields) ? input.fields : {}
  return {
    token: optionalText(input.token),
    baseId: optionalText(input.baseId),
    tableId: optionalText(input.tableId),
    view: optionalText(input.view),
    titleField: optionalText(input.titleField || fields.title),
    cardFields: migratedCardFields(input),
    webhook: migratedWebhook(input),
  }
}

function canonicalAirtableConfig(value: unknown): AirtableConfig {
  const input = isRecord(value) ? value : {}
  return {
    token: optionalText(input.token),
    baseId: optionalText(input.baseId),
    tableId: optionalText(input.tableId),
    view: optionalText(input.view),
    titleField: optionalText(input.titleField),
    cardFields: canonicalCardFields(input.cardFields),
    webhook: migratedWebhook(input),
  }
}

export function airtableConfig(host: ExtensionHostServices): ConfiguredAirtableConfig {
  const value = canonicalAirtableConfig(host.settings.read('config', EMPTY_CONFIG))
  return {
    ...value,
    configured: Boolean(value.token && value.baseId && value.tableId),
  }
}

export function normalizeAirtablePublicUrl(value: unknown) {
  let url: URL
  try {
    url = new URL(optionalText(value).trim())
  } catch {
    throw new Error('Public VertexADE URL must be a valid HTTPS origin')
  }
  const isOrigin = ['', '/'].includes(url.pathname) && !url.username && !url.password && !url.search && !url.hash
  if (url.protocol !== 'https:' || !isOrigin) {
    throw new Error('Public VertexADE URL must be a valid HTTPS origin')
  }
  return url.origin
}

function notificationUrl(publicUrl: string) {
  return new URL(AIRTABLE_WEBHOOK_PATH, publicUrl).toString()
}

export function publicAirtableSettings(config: ConfiguredAirtableConfig) {
  return {
    configured: config.configured,
    base_id: config.baseId,
    table_id: config.tableId,
    view: config.view,
    title_field: config.titleField,
    card_fields: config.cardFields,
    has_token: Boolean(config.token),
    live_sync: Boolean(config.webhook),
    public_url: config.webhook?.publicUrl || '',
    webhook_path: AIRTABLE_WEBHOOK_PATH,
    webhook_expires_at: config.webhook?.expirationTime || null,
  }
}

function hasValidMacSecret(value: string) {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').byteLength > 0
}

function checkedWebhookRegistration(value: unknown, publicUrl: string): AirtableWebhookRegistration {
  const input = isRecord(value) ? value : {}
  const id = optionalText(input.id).trim()
  const macSecretBase64 = optionalText(input.macSecretBase64).trim()
  if (!id || !hasValidMacSecret(macSecretBase64)) {
    throw new Error('Airtable did not return a usable webhook registration')
  }
  return {
    id,
    macSecretBase64,
    publicUrl,
    notificationUrl: notificationUrl(publicUrl),
    expirationTime: input.expirationTime ? String(input.expirationTime) : null,
  }
}

function hasSameWebhookTarget(current: AirtableConfig, next: AirtableConfig, publicUrl: string) {
  return Boolean(
    current.webhook &&
    current.token === next.token &&
    current.baseId === next.baseId &&
    current.tableId === next.tableId &&
    current.webhook.publicUrl === publicUrl,
  )
}

const webhookConfigurationFailure = {
  kind: 'validation' as const,
  message: 'Airtable webhook configuration failed',
  status: 400,
  code: 'AIRTABLE_WEBHOOK_CONFIGURATION_FAILED',
  causeMessage: 'replace' as const,
}

const webhookRemovalFailure = {
  kind: 'upstream' as const,
  message: 'Airtable webhook removal failed',
  status: 502,
  code: 'AIRTABLE_WEBHOOK_REMOVAL_FAILED',
  causeMessage: 'replace' as const,
}

function deleteClientWebhookEffect(
  client: Pick<AirtableClient, 'deleteWebhook'>,
  webhook: AirtableWebhookRegistration,
  failure: ApiFailureFallback,
): ApiEffect<unknown> {
  return tryApiPromise(() => client.deleteWebhook(webhook.id), failure)
}

function deleteWebhookEffect(
  provider: AirtableProvider,
  config: AirtableConfig,
  webhook: AirtableWebhookRegistration,
  failure: ApiFailureFallback = webhookConfigurationFailure,
) {
  return deleteClientWebhookEffect(provider.createClient(config), webhook, failure)
}

function replaceWebhookEffect(
  provider: AirtableProvider,
  current: AirtableConfig,
  next: AirtableConfig,
  publicUrl: string,
): ApiEffect<AirtableWebhookRegistration> {
  const nextClient = provider.createClient(next)
  return Effect.gen(function* () {
    const registration = yield* tryApiPromise(() => nextClient.createWebhook(notificationUrl(publicUrl)), webhookConfigurationFailure)
    const created = yield* tryApi(() => checkedWebhookRegistration(registration, publicUrl), webhookConfigurationFailure)
    if (!current.webhook) return created

    const removed = yield* Effect.either(deleteWebhookEffect(provider, current, current.webhook))
    if (Either.isLeft(removed)) {
      yield* deleteClientWebhookEffect(nextClient, created, webhookConfigurationFailure).pipe(Effect.ignore)
      return yield* Effect.fail(removed.left)
    }
    return created
  }).pipe(Effect.withSpan('airtable.webhook.replace'))
}

function reconcileWebhookEffect(
  provider: AirtableProvider,
  current: AirtableConfig,
  next: AirtableConfig,
  enabled: boolean,
  requestedPublicUrl: unknown,
): ApiEffect<AirtableWebhookRegistration | null> {
  if (!enabled) {
    return current.webhook
      ? deleteWebhookEffect(provider, current, current.webhook).pipe(Effect.as(null), Effect.withSpan('airtable.webhook.disable'))
      : Effect.succeed(null)
  }

  return tryApi(() => normalizeAirtablePublicUrl(requestedPublicUrl || current.webhook?.publicUrl), webhookConfigurationFailure).pipe(
    Effect.flatMap((publicUrl) =>
      hasSameWebhookTarget(current, next, publicUrl)
        ? Effect.succeed(current.webhook)
        : replaceWebhookEffect(provider, current, next, publicUrl),
    ),
    Effect.withSpan('airtable.webhook.reconcile'),
  )
}

function requestedCardFields(input: Record<string, unknown>, current: AirtableConfig) {
  return Array.isArray(input.card_fields) ? canonicalCardFields(input.card_fields) : current.cardFields
}

function requestedAirtableConfig(input: Record<string, unknown>, current: AirtableConfig): AirtableConfig {
  return {
    token: optionalText(input.token).trim() || current.token,
    baseId: optionalText(input.base_id).trim(),
    tableId: optionalText(input.table_id).trim(),
    view: optionalText(input.view).trim(),
    titleField: optionalText(input.title_field).trim(),
    cardFields: requestedCardFields(input, current),
    webhook: null,
  }
}

export async function saveAirtableSettings(request: Request, provider: AirtableProvider, host: ExtensionHostServices) {
  const input = await readJsonObject(request)
  const current = airtableConfig(host)
  const next = requestedAirtableConfig(input, current)
  if (!next.token || !next.baseId || !next.tableId || !next.titleField) {
    throw new HttpError('Personal access token, base ID, table, and card title field are required', 400)
  }

  const liveSync = Object.hasOwn(input, 'live_sync') ? input.live_sync === true : Boolean(current.webhook)
  next.webhook = await runApiEffect(reconcileWebhookEffect(provider, current, next, liveSync, input.public_url))

  host.settings.write('config', next)
  publishExtensionChange(host, 'airtable_settings_updated')
  return Response.json(publicAirtableSettings({ ...next, configured: true }))
}

export async function deleteAirtableSettings(provider: AirtableProvider, host: ExtensionHostServices) {
  const current = airtableConfig(host)
  if (current.webhook) {
    await runApiEffect(deleteWebhookEffect(provider, current, current.webhook, webhookRemovalFailure))
  }

  host.settings.delete('config')
  publishExtensionChange(host, 'airtable_settings_deleted')
  return Response.json(
    publicAirtableSettings({
      ...EMPTY_CONFIG,
      configured: false,
    }),
  )
}

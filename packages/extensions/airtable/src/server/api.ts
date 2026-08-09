import type { ExtensionHostServices, ExtensionRegistrationContext, RecordsProvider } from '@vertexade/platform-contracts'
import { loadExtensionData, publishExtensionChange } from '@vertexade/platform-server/extension-data'
import { HttpError, isRecord, readJsonObject } from '@vertexade/platform-server/http'
import { extensionWebhookDependencies } from '@vertexade/platform-server/webhooks'
import { AirtableClient } from './client.ts'
import { airtableConfig, deleteAirtableSettings, publicAirtableSettings, saveAirtableSettings } from './config.ts'
import type { AirtableConfig, ConfiguredAirtableConfig } from './types.ts'
import { handleAirtableWebhook } from './webhook.ts'

type AirtableProvider = RecordsProvider<AirtableConfig, AirtableClient>
type AirtableApiContext = {
  provider: AirtableProvider
  host: ExtensionHostServices
}
type AirtableField = {
  id?: unknown
  name?: unknown
  type?: unknown
  options?: {
    choices?: Array<{ name?: unknown }>
  }
}
type AirtableTable = {
  id?: unknown
  name?: unknown
  fields?: AirtableField[]
}

const EDITABLE_FIELD_TYPES = new Set(['singleLineText', 'multilineText', 'number', 'currency', 'percent', 'email', 'url', 'phoneNumber'])
const NUMBER_FIELD_TYPES = new Set(['number', 'currency', 'percent', 'duration'])

function requiredConfig(context: AirtableApiContext): ConfiguredAirtableConfig {
  const config = airtableConfig(context.host)
  if (!config.configured) throw new HttpError('Configure Airtable first', 503)
  return config
}

function inputFields(input: Record<string, unknown>) {
  return isRecord(input.fields) ? input.fields : {}
}

function portableInputType(fieldType: string) {
  if (fieldType === 'multilineText') return 'textarea'
  if (NUMBER_FIELD_TYPES.has(fieldType)) return 'number'
  return 'text'
}

function portableInputs(fields: AirtableField[], titleField: string, values: Record<string, unknown> = {}, creating = false) {
  return fields
    .filter((field) => String(field.name) === titleField || EDITABLE_FIELD_TYPES.has(String(field.type)))
    .map((field, index) => {
      const name = String(field.name)
      const type = String(field.type)
      return {
        name: `field_${index}`,
        label: name,
        type: portableInputType(type),
        required: name === titleField,
        defaultValue: typeof values[name] === 'number' ? values[name] : String(values[name] ?? ''),
        bodyPath: ['fields', name],
        omitWhenEmpty: creating && name !== titleField,
        ...(NUMBER_FIELD_TYPES.has(type) ? { emptyValue: 'null' } : {}),
      }
    })
}

export function airtablePortableGroupOrder(fields: AirtableField[] = []) {
  return fields
    .flatMap((field) =>
      (field.options?.choices || []).map((choice) => ({
        field: String(field.name || ''),
        value: String(choice.name || ''),
      })),
    )
    .filter((entry) => entry.field && entry.value)
}

function editableFields(table: AirtableTable | undefined) {
  return (table?.fields || []).map(({ id, name, type }) => ({ id, name, type }))
}

function decoratedRecord(record: Awaited<ReturnType<AirtableClient['records']>>[number], fields: AirtableField[], titleField: string) {
  return {
    ...record,
    portable_activity: record.created_at ? [{ title: 'Record created', detail: 'Airtable', at: record.created_at }] : [],
    portable_actions: [
      {
        id: 'edit-record',
        label: 'Edit record',
        description: 'Update this Airtable record.',
        method: 'PATCH',
        path: `/records/${encodeURIComponent(record.id)}`,
        inputs: portableInputs(fields, titleField, record.fields || {}),
        successMessage: 'Airtable record updated.',
      },
    ],
  }
}

function collectionActions(fields: AirtableField[], titleField: string) {
  return [
    {
      id: 'create-record',
      label: 'New record',
      description: 'Create a record in the connected Airtable table.',
      method: 'POST',
      path: '/records',
      inputs: portableInputs(fields, titleField, {}, true),
      successMessage: 'Airtable record created.',
    },
    {
      id: 'create-column',
      label: 'New column',
      description: 'Add a text column to the connected Airtable table.',
      method: 'POST',
      path: '/fields',
      inputs: [
        { name: 'name', label: 'Column name', type: 'text', required: true },
        {
          name: 'type',
          label: 'Column type',
          type: 'select',
          required: true,
          defaultValue: 'singleLineText',
          options: [
            { value: 'singleLineText', label: 'Single line text' },
            { value: 'multilineText', label: 'Multiline text' },
          ],
        },
      ],
      successMessage: 'Airtable column created.',
    },
  ]
}

async function loadBoard(request: Request, context: AirtableApiContext) {
  const config = airtableConfig(context.host)
  if (!config.configured) {
    return Response.json({
      configured: false,
      records: [],
      title_field: config.titleField,
      card_fields: config.cardFields,
    })
  }

  const loader = async () => {
    const client = context.provider.createClient(config)
    const schemaPromise = client.schema()
    const [records, schema] = await Promise.all([client.records(schemaPromise), schemaPromise])
    return { records, schema }
  }
  const forceRefresh = new URL(request.url).searchParams.get('force_refresh') === '1'
  const result = await loadExtensionData(context.host, 'board:records', loader, forceRefresh)

  const { records, schema } = result.value
  const table = (schema.tables || []).find((item) => item.id === config.tableId || item.name === config.tableId)
  const fields = editableFields(table)
  return Response.json({
    configured: true,
    records: records.map((record) => decoratedRecord(record, fields, config.titleField)),
    title_field: config.titleField,
    card_fields: config.cardFields,
    fields,
    portable_group_order: airtablePortableGroupOrder(table?.fields),
    repositories: context.host.repositories.list(),
    portable_collection_actions: collectionActions(fields, config.titleField),
    ...(result.cache ? { cache: result.cache } : {}),
  })
}

async function detectStructure(request: Request, context: AirtableApiContext) {
  const input = await readJsonObject(request)
  const current = airtableConfig(context.host)
  const token = String(input.token || '').trim() || current.token
  const baseId = String(input.base_id || '').trim()
  if (!token || !baseId) {
    throw new HttpError('Personal access token and base ID are required', 400)
  }

  const clientConfig = {
    ...current,
    token,
    baseId,
  }
  const schema = await context.provider.createClient(clientConfig).schema()
  const detected = context.provider.detectStructure?.(schema) as
    | {
        tables?: AirtableTable[]
      }
    | undefined
  return Response.json({
    ...detected,
    fields: (detected?.tables || []).flatMap((table) =>
      (table.fields || []).map((field) => ({
        ...field,
        table_id: String(table.id || ''),
        label: `${String(field.name || '')} · ${String(field.type || '')}`,
      })),
    ),
  })
}

async function createRecord(request: Request, context: AirtableApiContext) {
  const config = requiredConfig(context)
  const fields = inputFields(await readJsonObject(request))
  if (!String(fields[config.titleField] || '').trim()) {
    throw new HttpError(`${config.titleField} is required`, 400)
  }

  const record = await context.provider.createClient(config).create(fields)
  publishExtensionChange(context.host, 'airtable_record_created')
  return Response.json(record, { status: 201 })
}

async function updateRecord(request: Request, recordId: string, context: AirtableApiContext) {
  const config = requiredConfig(context)
  const fields = inputFields(await readJsonObject(request))
  const record = await context.provider.createClient(config).update(recordId, fields)
  publishExtensionChange(context.host, 'airtable_record_updated')
  return Response.json(record)
}

async function createField(request: Request, context: AirtableApiContext) {
  const config = requiredConfig(context)
  const input = await readJsonObject(request)
  const name = String(input.name || '').trim()
  if (!name) throw new HttpError('Column name is required', 400)

  const requestedType = String(input.type || '')
  const type = ['singleLineText', 'multilineText'].includes(requestedType) ? requestedType : 'singleLineText'
  const field = await context.provider.createClient(config).createField(name, type)
  publishExtensionChange(context.host, 'airtable_field_created')
  return Response.json(field, { status: 201 })
}

function recordDetails(record: Awaited<ReturnType<AirtableClient['records']>>[number]) {
  return record.card_fields
    .map((field) => {
      const value = field.relation ? field.relation.items.map((item) => item.title).join(', ') : field.value
      return `${field.name}: ${value}`
    })
    .join('\n')
}

async function launchRecordTask(request: Request, recordId: string, context: AirtableApiContext) {
  const config = requiredConfig(context)
  const input = await readJsonObject(request)
  const repository = context.host.repositories.get(Number(input.repository_id))
  if (!repository) throw new HttpError('Choose a repository', 404)

  const records = await context.provider.createClient(config).records()
  const record = records.find((item) => item.id === recordId)
  if (!record) throw new HttpError('Airtable record not found', 404)

  const details = recordDetails(record)
  const task = await context.host.tasks.launch(
    repository,
    `Airtable: ${record.title}`.slice(0, 100),
    `Implement Airtable work item: ${record.title}.\n\n${details || 'No additional card fields configured.'}\n\nInspect the repository and deliver the work item.`,
    input.create_pr !== false,
    'feature',
    {
      workspaceMode: 'combined',
      source: {
        provider: 'airtable',
        kind: 'record',
        externalId: String(record.id),
        role: 'source',
        label: record.title,
        primary: true,
      },
    },
  )
  return Response.json(task, { status: 202 })
}

export function registerAirtableApi(registration: ExtensionRegistrationContext, provider: AirtableProvider, host: ExtensionHostServices) {
  const context = { provider, host }
  const settings = () => airtableConfig(host)
  const webhook = extensionWebhookDependencies(host, settings)

  registration.routes.register({
    method: 'GET',
    path: '/settings',
    availability: 'installed',
    handler: () => Response.json(publicAirtableSettings(settings())),
  })
  registration.routes.register({
    method: 'POST',
    path: '/settings',
    availability: 'installed',
    handler: (request) => saveAirtableSettings(request, provider, host),
  })
  registration.routes.register({
    method: 'DELETE',
    path: '/settings',
    availability: 'installed',
    handler: () => deleteAirtableSettings(provider, host),
  })
  registration.routes.register({
    method: 'POST',
    path: '/webhook',
    handler: (request) => handleAirtableWebhook(request, webhook),
  })
  registration.routes.register({
    method: 'GET',
    path: '/board',
    handler: (request) => loadBoard(request, context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/detect',
    availability: 'installed',
    handler: (request) => detectStructure(request, context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/records',
    handler: (request) => createRecord(request, context),
  })
  registration.routes.register({
    method: 'PATCH',
    path: '/records/:recordId',
    handler: (request, { params }) => updateRecord(request, params.recordId ?? '', context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/fields',
    handler: (request) => createField(request, context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/records/:recordId/thread',
    handler: (request, { params }) => launchRecordTask(request, params.recordId ?? '', context),
  })
}

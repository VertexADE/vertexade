import { resilientFetch } from '@vertexade/platform-server/effect'

type AirtableClientConfig = {
  token: string
  baseId: string
  tableId?: string
  view?: string
  titleField?: string
  cardFields?: Array<{
    field: string
    resolve?: boolean
    style?: string
    placement?: string
  }>
}
type ResolvedAirtableClientConfig = {
  token: string
  baseId: string
  tableId: string
  view: string
  titleField: string
  cardFields: NonNullable<AirtableClientConfig['cardFields']>
}
type AirtableField = {
  id: string
  name: string
  type: string
  options?: {
    linkedTableId?: string
    choices?: Array<{ id?: string; name?: string; color?: string }>
  }
}
type AirtableTable = {
  id: string
  name: string
  primaryFieldId: string
  fields?: AirtableField[]
}
type AirtableSchema = {
  tables?: AirtableTable[]
}
type AirtableRecord = {
  id: string
  fields: Record<string, unknown>
  createdTime?: string
}
type LinkedRecord = {
  title: string
  imageUrl: string
}

function safeImageUrl(value: unknown) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function valueRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function nestedValue(record: Record<string, unknown>, ...path: string[]) {
  let value: unknown = record
  for (const segment of path) {
    const current = valueRecord(value)
    if (!current) return undefined
    value = current[segment]
  }
  return value
}

function imageFromField(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(imageFromField).find(Boolean) || ''
  }
  const item = valueRecord(value)
  if (!item) return ''

  const type = typeof item.type === 'string' ? item.type : ''
  const candidates = [
    item.profilePicUrl,
    item.avatarUrl,
    item.photoUrl,
    nestedValue(item, 'thumbnails', 'small', 'url'),
    nestedValue(item, 'thumbnails', 'large', 'url'),
    type.startsWith('image/') ? item.url : '',
  ]
  return candidates.map(safeImageUrl).find(Boolean) || ''
}

function recordImageUrl(record?: AirtableRecord) {
  return (
    Object.values(record?.fields || {})
      .map(imageFromField)
      .find(Boolean) || ''
  )
}

function relationFields(table?: AirtableTable) {
  return (table?.fields || []).filter((field) => field.type === 'multipleRecordLinks' && field.options?.linkedTableId)
}

function primaryFieldName(table?: AirtableTable) {
  return table?.fields?.find((field) => field.id === table.primaryFieldId)?.name || ''
}

function linkedRecord(record: AirtableRecord, primaryField: string): LinkedRecord {
  return {
    title: String(record.fields[primaryField] || 'Untitled'),
    imageUrl: recordImageUrl(record),
  }
}

function formatFieldValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const record = valueRecord(item)
        return record?.name || record?.email || String(item)
      })
      .join(', ')
  }
  const record = valueRecord(value)
  if (record) return String(record.name || record.email || JSON.stringify(record))
  return String(value ?? '')
}

export class AirtableClient {
  config: ResolvedAirtableClientConfig
  fetch: typeof globalThis.fetch

  constructor(config: AirtableClientConfig, fetchImpl = globalThis.fetch) {
    this.config = {
      tableId: '',
      view: '',
      titleField: '',
      cardFields: [],
      ...config,
    }
    this.fetch = fetchImpl
  }

  private requestUrl(path: string) {
    return `https://api.airtable.com/v0/${path}`
  }

  private requestOptions(options: RequestInit) {
    return {
      ...options,
      headers: {
        authorization: `Bearer ${this.config.token}`,
        'content-type': 'application/json',
        ...options.headers,
      },
    }
  }

  async request(path: string, options: RequestInit = {}): Promise<any> {
    const response = await resilientFetch({
      service: 'Airtable',
      fetch: this.fetch,
      url: this.requestUrl(path),
      init: this.requestOptions(options),
    })
    if (response.status === 204) return null

    const data = await response.json()
    if (!response.ok) {
      throw new Error(data?.error?.message || `Airtable request failed (${response.status})`)
    }
    return data
  }

  async listRecords(tableId: string, view = '') {
    const records: AirtableRecord[] = []
    let offset: string | undefined
    do {
      const query = new URLSearchParams({ pageSize: '100' })
      if (view) query.set('view', view)
      if (offset) query.set('offset', offset)

      const path = `${encodeURIComponent(this.config.baseId)}/${encodeURIComponent(tableId)}?${query}`
      const data = await this.request(path)
      records.push(...(data.records || []))
      offset = data.offset
    } while (offset)
    return records
  }

  private requestedRelationNames() {
    return new Set(this.config.cardFields.filter((field) => field.resolve).map((field) => field.field))
  }

  private async linkedRecordLookups(
    schema: AirtableSchema,
    sourceTable: AirtableTable | undefined,
    sourceRecords: AirtableRecord[],
    requestedRelations: Set<string>,
  ) {
    const tables = new Map((schema.tables || []).map((table) => [table.id, table]))
    const targetIds = relationFields(sourceTable)
      .filter((field) => requestedRelations.has(field.name))
      .flatMap((field) => field.options?.linkedTableId || [])
    const uniqueTargetIds = [...new Set(targetIds)]
    const lookups = new Map<string, Map<string, LinkedRecord>>()

    await Promise.all(
      uniqueTargetIds.map(async (tableId) => {
        const targetTable = tables.get(tableId)
        const values = tableId === sourceTable?.id && !this.config.view ? sourceRecords : await this.listRecords(tableId)
        const primaryField = primaryFieldName(targetTable)
        lookups.set(tableId, new Map(values.map((record) => [record.id, linkedRecord(record, primaryField)])))
      }),
    )
    return lookups
  }

  private resolvedRelations(
    record: AirtableRecord,
    sourceTable: AirtableTable | undefined,
    requestedRelations: Set<string>,
    lookups: Map<string, Map<string, LinkedRecord>>,
  ) {
    return relationFields(sourceTable).flatMap((field) => {
      if (!requestedRelations.has(field.name)) return []
      const ids = record.fields[field.name]
      if (!Array.isArray(ids) || !ids.length) return []

      const linkedTableId = field.options?.linkedTableId || ''
      const lookup = lookups.get(linkedTableId) || new Map()
      return [
        {
          field: field.name,
          table_id: linkedTableId,
          items: ids.map((value) => {
            const id = String(value)
            const linked = lookup.get(id)
            return {
              id,
              title: linked?.title || id,
              ...(linked?.imageUrl ? { image_url: linked.imageUrl } : {}),
            }
          }),
        },
      ]
    })
  }

  private portableRecord(record: AirtableRecord, relations: ReturnType<AirtableClient['resolvedRelations']>) {
    const byField = new Map(relations.map((relation) => [relation.field, relation]))
    const cardFields = this.config.cardFields
      .filter(({ field }) => record.fields[field] !== undefined)
      .map(({ field, style, placement }) => ({
        name: field,
        style,
        placement: placement || 'card',
        value: formatFieldValue(record.fields[field]),
        relation: byField.get(field) || null,
      }))
    return {
      id: record.id,
      title: String(record.fields[this.config.titleField] || 'Untitled'),
      fields: record.fields,
      card_fields: cardFields,
      linked_items: relations.flatMap((relation) => relation.items),
      created_at: record.createdTime,
    }
  }

  async records(schemaPromise?: Promise<AirtableSchema>) {
    const recordsPromise = this.listRecords(this.config.tableId, this.config.view)
    const schemaRequest = schemaPromise ?? this.schema()
    const [records, schema] = await Promise.all([recordsPromise, schemaRequest])
    const table = (schema.tables || []).find((item) => item.id === this.config.tableId || item.name === this.config.tableId)
    const requestedRelations = this.requestedRelationNames()
    const lookups = await this.linkedRecordLookups(schema, table, records, requestedRelations)
    return records.map((record) => this.portableRecord(record, this.resolvedRelations(record, table, requestedRelations, lookups)))
  }

  async schema(): Promise<AirtableSchema> {
    return this.request(`meta/bases/${encodeURIComponent(this.config.baseId)}/tables`)
  }

  private normalize(record: AirtableRecord) {
    return {
      id: record.id,
      title: String(record.fields[this.config.titleField] || 'Untitled'),
      card_fields: [],
      linked_items: [],
      created_at: record.createdTime,
    }
  }

  async create(fields: Record<string, unknown>) {
    const data = await this.request(`${encodeURIComponent(this.config.baseId)}/${encodeURIComponent(this.config.tableId)}`, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    })
    return this.normalize(data)
  }

  // fallow-ignore-next-line unused-class-member -- invoked through the RecordsProvider client contract.
  async update(id: string, fields: Record<string, unknown>) {
    const data = await this.request(
      `${encodeURIComponent(this.config.baseId)}/${encodeURIComponent(this.config.tableId)}/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ fields }),
      },
    )
    return this.normalize(data)
  }

  async createField(name: string, type: string) {
    return this.request(`meta/bases/${encodeURIComponent(this.config.baseId)}/tables/${encodeURIComponent(this.config.tableId)}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name, type }),
    })
  }

  async createWebhook(notificationUrl: string) {
    return this.request(`bases/${encodeURIComponent(this.config.baseId)}/webhooks`, {
      method: 'POST',
      body: JSON.stringify({
        notificationUrl,
        specification: {
          options: {
            filters: {
              dataTypes: ['tableData'],
              recordChangeScope: this.config.tableId,
            },
          },
        },
      }),
    })
  }

  async deleteWebhook(webhookId: string) {
    return this.request(`bases/${encodeURIComponent(this.config.baseId)}/webhooks/${encodeURIComponent(webhookId)}`, {
      method: 'DELETE',
    })
  }
}

export function detectAirtableStructure(schema: AirtableSchema) {
  const tables = (schema.tables || [])
    .map((table) => {
      const fields = table.fields || []
      const linked = fields.filter((field) => field.type === 'multipleRecordLinks')
      const primary = fields.find((field) => field.id === table.primaryFieldId)
      return {
        id: table.id,
        name: table.name,
        primary_field: primary?.name || fields[0]?.name || '',
        fields: fields.map(({ id, name, type, options }) => ({
          id,
          name,
          type,
          linked_table_id: options?.linkedTableId || null,
        })),
        score: linked.length,
        hierarchy_detected: Boolean(linked.length),
      }
    })
    .sort((left, right) => right.score - left.score)
  return {
    tables,
    recommended_table_id: tables[0]?.id || null,
  }
}

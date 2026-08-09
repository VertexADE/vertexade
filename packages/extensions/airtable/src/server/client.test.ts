import { describe, expect, it } from 'vite-plus/test'
import { AirtableClient, detectAirtableStructure } from './client.ts'

describe('Airtable structure detection', () => {
  it('prefers a linked table and exposes its primary field without semantic mappings', () => {
    const result = detectAirtableStructure({
      tables: [
        {
          id: 'tblWork',
          name: 'Work',
          primaryFieldId: 'fldName',
          fields: [
            { id: 'fldName', name: 'Summary', type: 'singleLineText' },
            {
              id: 'fldParent',
              name: 'Parent item',
              type: 'multipleRecordLinks',
              options: { linkedTableId: 'tblWork' },
            },
            { id: 'fldState', name: 'Status', type: 'singleSelect' },
          ],
        },
      ],
    })
    expect(result.recommended_table_id).toBe('tblWork')
    expect(result.tables[0]).toMatchObject({ hierarchy_detected: true, primary_field: 'Summary' })
    expect(result.tables[0]).not.toHaveProperty('mapping')
  })
  it('resolves records linked from another table', async () => {
    const responses = [
      { records: [{ id: 'rec1', fields: { Title: 'Build it', Owner: ['usr1'] } }] },
      {
        tables: [
          {
            id: 'work',
            primaryFieldId: 'title',
            fields: [
              { id: 'title', name: 'Title', type: 'singleLineText' },
              {
                id: 'owner',
                name: 'Owner',
                type: 'multipleRecordLinks',
                options: { linkedTableId: 'people' },
              },
            ],
          },
          {
            id: 'people',
            primaryFieldId: 'name',
            fields: [
              { id: 'name', name: 'Name', type: 'singleLineText' },
              { id: 'photo', name: 'Photo', type: 'multipleAttachments' },
              {
                id: 'team',
                name: 'Team',
                type: 'multipleRecordLinks',
                options: { linkedTableId: 'teams' },
              },
            ],
          },
          {
            id: 'teams',
            primaryFieldId: 'name',
            fields: [
              { id: 'name', name: 'Name', type: 'singleLineText' },
              {
                id: 'lead',
                name: 'Lead',
                type: 'multipleRecordLinks',
                options: { linkedTableId: 'people' },
              },
            ],
          },
        ],
      },
      {
        records: [
          {
            id: 'usr1',
            fields: {
              Name: 'Ada',
              Photo: [{ type: 'image/png', url: 'https://images.example.test/ada.png' }],
              Team: ['team1'],
            },
          },
        ],
      },
      { records: [{ id: 'team1', fields: { Name: 'Platform', Lead: ['usr1'] } }] },
    ]
    const fetchMock = async () => ({ ok: true, json: async () => responses.shift() })
    const client = new AirtableClient(
      {
        token: 'pat',
        baseId: 'app',
        tableId: 'work',
        view: '',
        titleField: 'Title',
        cardFields: [{ field: 'Owner', style: 'links', resolve: true }],
      },
      fetchMock as unknown as typeof fetch,
    )
    const records = await client.records()
    expect(records).toMatchObject([
      {
        card_fields: [
          {
            name: 'Owner',
            style: 'links',
            placement: 'card',
            relation: {
              items: [{ id: 'usr1', title: 'Ada', image_url: 'https://images.example.test/ada.png' }],
            },
          },
        ],
      },
    ])
    expect(records[0]!.card_fields[0]!.relation!.items[0]).not.toHaveProperty('relations')
  })
  it('only resolves requested linked fields and returns selected display fields', async () => {
    const responses = [
      {
        records: [{ id: 'rec1', fields: { Title: 'Build it', Owner: ['usr1'], Notes: 'Visible' } }],
      },
      {
        tables: [
          {
            id: 'work',
            primaryFieldId: 'title',
            fields: [
              { id: 'title', name: 'Title', type: 'singleLineText' },
              {
                id: 'owner',
                name: 'Owner',
                type: 'multipleRecordLinks',
                options: { linkedTableId: 'people' },
              },
            ],
          },
          {
            id: 'people',
            primaryFieldId: 'name',
            fields: [{ id: 'name', name: 'Name', type: 'singleLineText' }],
          },
        ],
      },
      { records: [{ id: 'usr1', fields: { Name: 'Ada' } }] },
    ]
    const fetchMock = async () => ({ ok: true, json: async () => responses.shift() })
    const client = new AirtableClient(
      {
        token: 'pat',
        baseId: 'app',
        tableId: 'work',
        view: '',
        titleField: 'Title',
        cardFields: [
          { field: 'Notes', style: 'text', resolve: false },
          { field: 'Owner', style: 'badge', resolve: false },
        ],
      },
      fetchMock as unknown as typeof fetch,
    )
    await expect(client.records()).resolves.toMatchObject([
      {
        title: 'Build it',
        card_fields: [
          { name: 'Notes', value: 'Visible', style: 'text', placement: 'card', relation: null },
          { name: 'Owner', value: 'usr1', style: 'badge', placement: 'card', relation: null },
        ],
      },
    ])
  })
  it('keeps arbitrary Airtable field types available to the builder', () => {
    const result = detectAirtableStructure({
      tables: [
        {
          id: 'tbl',
          name: 'Items',
          primaryFieldId: 'title',
          fields: [
            { id: 'title', name: 'Work item', type: 'singleLineText' },
            { id: 'owner', name: 'Person', type: 'singleCollaborator' },
            { id: 'body', name: 'Body', type: 'multilineText' },
          ],
        },
      ],
    })
    expect(result.tables[0]).toMatchObject({
      primary_field: 'Work item',
      fields: [
        { name: 'Work item', type: 'singleLineText' },
        { name: 'Person', type: 'singleCollaborator' },
        { name: 'Body', type: 'multilineText' },
      ],
    })
  })
  it('preserves raw fields for the editable grid', async () => {
    const responses = [
      { records: [{ id: 'rec1', fields: { Title: 'Build it', Estimate: 3 } }] },
      {
        tables: [
          {
            id: 'work',
            primaryFieldId: 'title',
            fields: [
              { id: 'title', name: 'Title', type: 'singleLineText' },
              { id: 'estimate', name: 'Estimate', type: 'number' },
            ],
          },
        ],
      },
    ]
    const fetchMock = async () => ({ ok: true, json: async () => responses.shift() })
    const client = new AirtableClient(
      {
        token: 'pat',
        baseId: 'app',
        tableId: 'work',
        view: '',
        titleField: 'Title',
        cardFields: [],
      },
      fetchMock as unknown as typeof fetch,
    )
    await expect(client.records()).resolves.toMatchObject([{ id: 'rec1', fields: { Title: 'Build it', Estimate: 3 } }])
  })
  it('loads every Airtable page until no offset remains', async () => {
    const urls: string[] = []
    const fetchMock = async (url: string) => {
      urls.push(url)
      const offset = new URL(url).searchParams.get('offset')
      return {
        ok: true,
        json: async () =>
          offset === 'next-page'
            ? { records: [{ id: 'rec2', fields: { Title: 'Second' } }] }
            : { records: [{ id: 'rec1', fields: { Title: 'First' } }], offset: 'next-page' },
      }
    }
    const client = new AirtableClient(
      {
        token: 'pat',
        baseId: 'app',
        tableId: 'work',
        view: 'Grid',
        titleField: 'Title',
        cardFields: [],
      },
      fetchMock as unknown as typeof fetch,
    )
    await expect(client.listRecords('work', 'Grid')).resolves.toHaveLength(2)
    expect(urls).toHaveLength(2)
    expect(new URL(urls[0]!).searchParams.get('pageSize')).toBe('100')
    expect(new URL(urls[0]!).searchParams.get('view')).toBe('Grid')
    expect(new URL(urls[1]!).searchParams.get('offset')).toBe('next-page')
  })
  it('creates fields through the Airtable metadata API', async () => {
    let request: { url: string; options: RequestInit } | undefined
    const fetchMock = async (url: string, options: RequestInit) => {
      request = { url, options }
      return {
        ok: true,
        json: async () => ({ id: 'fldNotes', name: 'Notes', type: 'multilineText' }),
      }
    }
    const client = new AirtableClient({ token: 'pat', baseId: 'app', tableId: 'work' }, fetchMock as unknown as typeof fetch)
    await expect(client.createField('Notes', 'multilineText')).resolves.toMatchObject({
      id: 'fldNotes',
    })
    const capturedRequest = request!
    expect(capturedRequest.url).toBe('https://api.airtable.com/v0/meta/bases/app/tables/work/fields')
    expect(JSON.parse(String(capturedRequest.options.body))).toEqual({
      name: 'Notes',
      type: 'multilineText',
    })
  })
  it('creates and removes a table-scoped Airtable webhook', async () => {
    const requests: Array<{ url: string; options: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ id: 'ach1', macSecretBase64: 'c2VjcmV0' }), { status: 200 }),
      new Response(null, { status: 204 }),
    ]
    const fetchMock = async (url: string, options: RequestInit) => {
      requests.push({ url, options })
      return responses.shift()!
    }
    const client = new AirtableClient({ token: 'pat', baseId: 'app', tableId: 'work' }, fetchMock as unknown as typeof fetch)
    await expect(client.createWebhook('https://vertexade.example/api/extensions/airtable/webhook')).resolves.toMatchObject({ id: 'ach1' })
    await expect(client.deleteWebhook('ach1')).resolves.toBeNull()
    expect(requests[0].url).toBe('https://api.airtable.com/v0/bases/app/webhooks')
    expect(JSON.parse(String(requests[0]!.options.body))).toEqual({
      notificationUrl: 'https://vertexade.example/api/extensions/airtable/webhook',
      specification: {
        options: { filters: { dataTypes: ['tableData'], recordChangeScope: 'work' } },
      },
    })
    expect(requests[1]).toMatchObject({
      url: 'https://api.airtable.com/v0/bases/app/webhooks/ach1',
      options: { method: 'DELETE' },
    })
  })
  it('retries transient connection failures', async () => {
    let attempts = 0
    const fetchMock = async () => {
      attempts += 1
      if (attempts === 1) throw new Error('connection reset')
      return { ok: true, json: async () => ({ tables: [] }) }
    }
    await expect(new AirtableClient({ token: 'pat', baseId: 'app' }, fetchMock as unknown as typeof fetch).schema()).resolves.toEqual({
      tables: [],
    })
    expect(attempts).toBe(2)
  })
  it('does not retry creates after an ambiguous connection failure', async () => {
    let attempts = 0
    const fetchMock = async () => {
      attempts += 1
      throw new Error('connection reset')
    }
    await expect(
      new AirtableClient({ token: 'pat', baseId: 'app', tableId: 'work' }, fetchMock).create({
        Title: 'New',
      }),
    ).rejects.toThrow('connection reset')
    expect(attempts).toBe(1)
  })
})

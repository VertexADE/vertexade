import { describe, expect, it } from 'vite-plus/test'
import { airtablePortableGroupOrder } from './api.ts'
import { migrateAirtableConfig, normalizeAirtablePublicUrl } from './config.ts'

describe('Airtable configuration migration', () => {
  it('rewrites earlier field mappings into the canonical card model once', () => {
    expect(
      migrateAirtableConfig({
        token: 'secret',
        baseId: 'app',
        tableId: 'work',
        fields: { title: 'Summary' },
        visibleFields: ['Owner', 'State'],
        resolveFields: ['Owner'],
      }),
    ).toEqual({
      token: 'secret',
      baseId: 'app',
      tableId: 'work',
      view: '',
      titleField: 'Summary',
      cardFields: [
        { field: 'Owner', style: 'links', resolve: true, placement: 'card' },
        { field: 'State', style: 'text', resolve: false, placement: 'card' },
      ],
      webhook: null,
    })
  })

  it('accepts only a public HTTPS origin for managed notifications', () => {
    expect(normalizeAirtablePublicUrl('https://vertexade.example/')).toBe('https://vertexade.example')
    expect(() => normalizeAirtablePublicUrl('http://vertexade.example')).toThrow('valid HTTPS origin')
    expect(() => normalizeAirtablePublicUrl('https://vertexade.example/private/path')).toThrow('valid HTTPS origin')
    expect(() => normalizeAirtablePublicUrl('https://user:secret@vertexade.example')).toThrow('valid HTTPS origin')
  })
})

describe('Airtable portable board metadata', () => {
  it('preserves each single-select field choice order', () => {
    expect(
      airtablePortableGroupOrder([
        {
          name: 'Status',
          options: { choices: [{ name: 'Ready' }, { name: 'Doing' }, { name: 'Done' }] },
        },
        { name: 'Priority', options: { choices: [{ name: 'Urgent' }, { name: 'Normal' }] } },
        { name: 'Owner' },
      ]),
    ).toEqual([
      { field: 'Status', value: 'Ready' },
      { field: 'Status', value: 'Doing' },
      { field: 'Status', value: 'Done' },
      { field: 'Priority', value: 'Urgent' },
      { field: 'Priority', value: 'Normal' },
    ])
  })
})

import { AirtableClient, detectAirtableStructure } from './client.ts'
import {
  PLATFORM_API_VERSION,
  type DashboardExtension,
  type ExtensionHostServices,
  type RecordsProvider,
  type WorkReferenceProvider,
} from '@vertexade/platform-contracts'
import { loadExtensionData } from '@vertexade/platform-server/extension-data'
import { registerAirtableApi } from './api.ts'
import { airtableConfig, migrateAirtableConfig } from './config.ts'
import { airtableRecordsSurface } from '../shared/surfaces.ts'
import { airtableSettings } from '../shared/settings.ts'
import type { AirtableConfig } from './types.ts'

type AirtableRecord = Awaited<ReturnType<AirtableClient['records']>>[number]

function recordContext(record: AirtableRecord) {
  return Object.fromEntries(
    record.card_fields.map((field) => [
      field.name,
      field.relation ? field.relation.items.map((item) => item.title).join(', ') : field.value,
    ]),
  )
}

function matchesRecord(record: AirtableRecord, query: string) {
  if (!query) return true
  const searchable = [record.title, ...record.card_fields.map((field) => field.value)].join(' ').toLowerCase()
  return searchable.includes(query)
}

export function createExtension({ host }: { host: ExtensionHostServices }): DashboardExtension {
  const provider: RecordsProvider<AirtableConfig, AirtableClient> = {
    id: 'airtable',
    name: 'Airtable',
    createClient: (config) => new AirtableClient(config),
    detectStructure: detectAirtableStructure,
  }
  const references: WorkReferenceProvider = {
    id: 'airtable',
    name: 'Airtable',
    async references(query = '') {
      const config = airtableConfig(host)
      if (!config.configured) return []
      const needle = query.trim().toLowerCase()
      const loader = () => provider.createClient(config).records()
      const { value: records } = await loadExtensionData(host, 'references:records', loader)
      return records
        .filter((record) => matchesRecord(record, needle))
        .map((record) => {
          const context = recordContext(record)
          return {
            provider: 'airtable',
            kind: 'record',
            externalId: String(record.id),
            label: record.title,
            url: `https://airtable.com/${config.baseId}/${config.tableId}/${record.id}`,
            summary: Object.entries(context)
              .map(([name, value]) => `${name}: ${value}`)
              .join('\n'),
            metadata: context,
          }
        })
    },
  }
  return {
    migrations: [
      {
        version: 1,
        name: 'canonical-airtable-configuration',
        migrate() {
          if (host.settings.has('config')) host.settings.write('config', migrateAirtableConfig(host.settings.read('config', {})))
        },
      },
    ],
    manifest: {
      id: 'airtable',
      name: 'Airtable',
      version: '0.0.1',
      platformApi: PLATFORM_API_VERSION,
      kind: 'records',
      description: 'Use an Airtable base as a flexible work board.',
      catalog: {
        tagline: 'Turn a flexible Airtable base into an actionable work board',
        category: 'data',
        publisher: { name: 'VertexADE', url: 'https://airtable.com' },
        icon: { asset: 'assets/icon.svg' },
        accent: 'amber',
        tags: ['Records', 'Boards', 'Planning'],
        highlights: ['Automatic base structure detection', 'Live authenticated board synchronization', 'Launch work from a record'],
        links: {
          homepage: 'https://airtable.com',
          documentation: 'https://airtable.com/developers/web/api/introduction',
        },
      },
      portable: { surfaces: [airtableRecordsSurface], settings: airtableSettings },
      requires: { agent: true },
      permissions: ['settings.read', 'settings.write', 'repositories.read', 'tasks.launch', 'events.emit', 'cache.read', 'cache.write'],
      ui: {
        workResources: [
          {
            kind: 'record',
            label: 'Airtable record',
            tone: 'amber',
            routeTemplate: '/extensions/airtable',
          },
        ],
        commands: [
          {
            id: 'airtable.open-board',
            label: 'Open Airtable board',
            description: 'Browse connected planning records',
            to: '/extensions/airtable',
            keywords: ['records', 'planning'],
          },
        ],
      },
      providers: [
        { id: 'airtable', name: 'Airtable', kind: 'records' },
        { id: 'airtable', name: 'Airtable', kind: 'work-reference' },
      ],
    },
    status: () => ({ configured: airtableConfig(host).configured }),
    register(registration) {
      const { providers } = registration
      providers.records.register(provider)
      providers.workReferences.register(references)
      registerAirtableApi(registration, provider, host)
    },
  }
}

import { AzureDevOpsClient, azureConfig, type AzureConfig } from './client.ts'
import {
  PLATFORM_API_VERSION,
  type DashboardExtension,
  type WorkManagementProvider,
  type WorkReferenceProvider,
} from '@vertexade/platform-contracts'
import { Effect } from 'effect'
import { runApiEffect } from '@vertexade/platform-server/effect'
import { loadExtensionData } from '@vertexade/platform-server/extension-data'
import type { AzureExtensionHostServices } from './host-contract.ts'
import { azureSettings, registerAzureDevOpsApi } from './api.ts'
import { createCacheRefreshTrigger } from '@vertexade/platform-server/cache-trigger'
import { azureWorkItemsSurface } from '../shared/surfaces.ts'
import { azureDevOpsSettings } from '../shared/settings.ts'
import { azureRequestEffect } from './effect.ts'

type Value = Record<string, any>

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function firstText(...values: unknown[]) {
  return values.map(text).find(Boolean) ?? ''
}

function matchesReference(item: Value, query: string) {
  if (!query) return true
  return [item.id, item.title, item.description, item.acceptance_criteria].map(text).join(' ').toLowerCase().includes(query)
}

function currentIteration(iterations: Value[]) {
  return iterations.find((item) => item.timeframe === 'current') ?? iterations[0]
}

async function iterationItems(client: AzureDevOpsClient, iteration: Value | undefined, signal?: AbortSignal) {
  if (!iteration?.path) return []
  return client.sprintItems(iteration.path, signal)
}

function azureReference(item: Value, config: Value) {
  const type = firstText(item.type, 'Work item')
  const url = firstText(item.url, `${config.url}/${encodeURIComponent(config.project)}/_workitems/edit/${item.id}`)
  return {
    provider: 'azure-devops',
    kind: 'work_item',
    externalId: String(item.id),
    label: `${type} #${item.id}: ${item.title}`,
    url,
    state: firstText(item.state) || null,
    summary: firstText(item.description, item.acceptance_criteria) || null,
    metadata: {
      type: firstText(item.type),
      description: firstText(item.description),
      acceptance_criteria: firstText(item.acceptance_criteria),
      iteration: firstText(item.iteration_path),
      assigned_to: firstText(item.assigned_to?.display_name),
    },
  }
}

export function createExtension({ host }: { host: AzureExtensionHostServices }): DashboardExtension {
  const refreshTrigger = createCacheRefreshTrigger({
    id: 'azure-devops.board-refreshed',
    name: 'Azure board refreshed',
    description: 'When Azure Boards work items are fetched from the upstream service.',
    resource: 'board',
    properties: {
      count: { type: 'integer', title: 'Work item count', minimum: 0 },
      iteration: { type: 'string', title: 'Iteration path' },
    },
  })
  const provider: WorkManagementProvider<AzureConfig, AzureDevOpsClient> = {
    id: 'azure-devops',
    name: 'Azure DevOps',
    normalizeConfig: (input = {}) => azureConfig(input),
    createClient: (config) => new AzureDevOpsClient(config),
  }
  const references: WorkReferenceProvider = {
    id: 'azure-devops',
    name: 'Azure DevOps',
    async references(query = '', context) {
      const config = azureSettings(provider, host)
      if (!config.configured) return []
      const loader = async () => {
        const client = provider.createClient(config)
        const [iterations, features] = await runApiEffect(
          Effect.all(
            [
              azureRequestEffect('reference-iterations', (signal) => client.iterations(signal)),
              azureRequestEffect('reference-features', (signal) => client.features(signal)),
            ],
            { concurrency: 'unbounded' },
          ),
        )
        const items = await runApiEffect(
          azureRequestEffect('reference-items', (signal) => iterationItems(client, currentIteration(iterations), signal)),
        )
        refreshTrigger.emitRefresh({
          force: Boolean(context?.forceRefresh),
          provider: 'azure-devops',
          key: 'references:current',
          subject: 'azure-devops:references',
          data: { count: features.length + items.length },
        })
        return { features, items }
      }
      const {
        value: { features, items },
      } = await loadExtensionData(host, 'references:current', loader, Boolean(context?.forceRefresh))
      const needle = query.trim().toLowerCase()
      return [...features, ...items]
        .filter((item: Value) => matchesReference(item, needle))
        .map((item: Value) => azureReference(item, config))
    },
  }
  return {
    manifest: {
      id: 'azure-devops',
      name: 'Azure DevOps Boards',
      version: '0.0.1',
      platformApi: PLATFORM_API_VERSION,
      kind: 'work-management',
      description: 'Plan and track delivery work in Azure DevOps Boards.',
      catalog: {
        tagline: 'Plan delivery work alongside repositories and agent tasks',
        category: 'planning',
        publisher: { name: 'VertexADE', url: 'https://azure.microsoft.com/products/devops' },
        icon: { asset: 'assets/icon.svg' },
        accent: 'blue',
        tags: ['Planning', 'Boards', 'Work items'],
        featured: true,
        highlights: ['Browse boards and work items', 'Live authenticated board synchronization', 'Launch linked agent work'],
        links: {
          homepage: 'https://azure.microsoft.com/products/devops',
          documentation: 'https://learn.microsoft.com/azure/devops',
        },
      },
      portable: { surfaces: [azureWorkItemsSurface], settings: azureDevOpsSettings },
      requires: { agent: true },
      permissions: [
        'settings.read',
        'settings.write',
        'repositories.read',
        'tasks.launch',
        'tasks.plan',
        'events.emit',
        'cache.read',
        'cache.write',
      ],
      contributes: {
        triggers: [refreshTrigger.capability],
      },
      ui: {
        runKinds: [
          {
            kind: 'planning',
            label: 'Sprint planning',
            titleFallback: 'Planning',
            workKind: 'investigation',
            tone: 'blue',
          },
        ],
        workResources: [
          {
            kind: 'work_item',
            label: 'Azure work item',
            tone: 'blue',
            routeTemplate: '/extensions/azure-devops',
          },
          {
            kind: 'iteration',
            label: 'Azure iteration',
            tone: 'blue',
            routeTemplate: '/extensions/azure-devops',
          },
        ],
        commands: [
          {
            id: 'azure-devops.open-board',
            label: 'Open Azure board',
            description: 'Browse connected delivery work',
            to: '/extensions/azure-devops',
            keywords: ['planning', 'work items'],
          },
        ],
      },
      providers: [
        { id: 'azure-devops', name: 'Azure DevOps', kind: 'work-management' },
        { id: 'azure-devops', name: 'Azure DevOps', kind: 'work-reference' },
      ],
    },
    status: () => ({ configured: azureSettings(provider, host).configured }),
    register(registration) {
      const { providers } = registration
      providers.workManagement.register(provider)
      providers.workReferences.register(references)
      registration.triggers.register(refreshTrigger.capability)
      registerAzureDevOpsApi(registration, provider, host, refreshTrigger)
    },
  }
}

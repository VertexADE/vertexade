import type { ReactiveProjectionPolicy } from '@vertexade/platform-contracts'

export const dashboardCollections = ['repositories', 'pullRequests', 'agentThreads', 'dashboardMeta', 'workItems'] as const
export const maxFederatedReadModelResponseBytes = 64 * 1024 * 1024

export type DashboardCollection = (typeof dashboardCollections)[number]

const workItemArrayFields = ['repository_names', 'resources', 'threads', 'events', 'relations', 'context_transfers'] as const

export function normalizeDashboardCollectionValues<T extends object>(collection: DashboardCollection, values: T[]): T[] {
  if (collection !== 'workItems') return values
  return values.map((value) => {
    const record = value as Record<string, unknown>
    const missing = workItemArrayFields.filter((field) => !Array.isArray(record[field]))
    if (!missing.length) return value
    return Object.assign({}, value, Object.fromEntries(missing.map((field) => [field, []])))
  })
}

export const dashboardProjectionPolicies = {
  repositories: {
    id: 'repositories',
    storage: 'persistent',
    sensitivity: 'internal',
    sourceOfTruth: 'server',
    allowsOfflineWrites: false,
    topics: ['dashboard', 'work'],
    description: 'Repository identity and synchronization metadata.',
  },
  pullRequests: {
    id: 'pullRequests',
    storage: 'persistent',
    sensitivity: 'internal',
    sourceOfTruth: 'server',
    allowsOfflineWrites: false,
    topics: ['dashboard', 'work'],
    description: 'Compact pull request status used by overview surfaces.',
  },
  agentThreads: {
    id: 'agentThreads',
    storage: 'persistent',
    sensitivity: 'sensitive',
    sourceOfTruth: 'server',
    allowsOfflineWrites: false,
    topics: ['runs', 'work'],
    description: 'Compact agent thread summaries without prompts, logs, review payloads, or raw diffs.',
  },
  dashboardMeta: {
    id: 'dashboardMeta',
    storage: 'persistent',
    sensitivity: 'internal',
    sourceOfTruth: 'server',
    allowsOfflineWrites: false,
    topics: ['dashboard', 'extensions'],
    description: 'Presentation settings and extension catalog metadata.',
  },
  workItems: {
    id: 'workItems',
    storage: 'persistent',
    sensitivity: 'sensitive',
    sourceOfTruth: 'server',
    allowsOfflineWrites: false,
    topics: ['work', 'runs'],
    description: 'Compact Work board summaries without event history or context transfers.',
  },
} satisfies Record<DashboardCollection, ReactiveProjectionPolicy>

export type DashboardCacheDocument = {
  id: string
  bucket: DashboardCollection
  key: string
  value: Record<string, unknown>
  sourceUpdatedAt: string | null
  position: number
  serverVersion: number
}

export type DashboardSyncDocument = {
  id: 'dashboard'
  instanceId: string
  version: number
  syncedAt: string
}

export type ReadModelEntry = {
  key: string
  value: Record<string, unknown>
  sourceUpdatedAt: string | null
  position: number
}

export type ReadModelUpdate = {
  version: number
  mode: 'replace' | 'patch'
  entries?: ReadModelEntry[]
  upserts?: ReadModelEntry[]
  deletes?: string[]
}

export type ReadModelResponse = {
  instanceId: string
  version: number
  updates: Partial<Record<DashboardCollection, ReadModelUpdate>>
}

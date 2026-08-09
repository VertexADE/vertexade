import type { ApiBackend } from './api-backend'
import type { DashboardCollection, ReadModelEntry, ReadModelResponse } from './dashboard-cache-model'

export const federatedIdSpan = 1_000_000_000

export type BackendStatus = Omit<ApiBackend, 'url'> & {
  connected: boolean
  lastConnectedAt: string | null
  error: string | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function integer(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export function federatedId(backend: Pick<ApiBackend, 'namespace'>, value: unknown) {
  const local = integer(value)
  if (local === null) return value
  if (local >= federatedIdSpan) throw new Error(`Backend entity id ${local} exceeds the supported federation range`)
  const namespaced = backend.namespace * federatedIdSpan + local
  if (!Number.isSafeInteger(namespaced)) throw new Error(`Backend namespace ${backend.namespace} exceeds the supported federation range`)
  return namespaced
}

export function localId(value: unknown) {
  const namespaced = integer(value)
  return namespaced === null ? value : namespaced % federatedIdSpan
}

export function namespaceFromId(value: unknown) {
  const namespaced = integer(value)
  return namespaced === null ? null : Math.floor(namespaced / federatedIdSpan)
}

export function federatedWorkKey(backend: Pick<ApiBackend, 'id' | 'namespace'>, value: unknown) {
  const local = String(value || '')
  return backend.namespace ? `${backend.id}~${local}` : local
}

export function localWorkKey(backend: Pick<ApiBackend, 'id' | 'namespace'>, value: unknown) {
  const key = String(value || '')
  const prefix = `${backend.id}~`
  return backend.namespace && key.startsWith(prefix) ? key.slice(prefix.length) : key
}

function sourceFields(backend: BackendStatus, local: unknown, localKey?: unknown) {
  return {
    backend_id: backend.id,
    backend_name: backend.label,
    backend_connected: backend.connected,
    backend_local_id: integer(local),
    ...(localKey === undefined ? {} : { backend_local_key: String(localKey) }),
  }
}

function normalizeRepository(value: Record<string, unknown>, backend: BackendStatus) {
  return {
    ...value,
    ...sourceFields(backend, value.id),
    id: federatedId(backend, value.id),
  }
}

function normalizePullRequest(value: Record<string, unknown>, backend: BackendStatus) {
  return {
    ...value,
    ...sourceFields(backend, value.id),
    id: federatedId(backend, value.id),
    repo_id: federatedId(backend, value.repo_id),
    latest_agent_review_id:
      value.latest_agent_review_id == null ? value.latest_agent_review_id : federatedId(backend, value.latest_agent_review_id),
  }
}

function normalizeJob(value: Record<string, unknown>, backend: BackendStatus) {
  return {
    ...value,
    ...sourceFields(backend, value.id),
    id: federatedId(backend, value.id),
    repo_id: federatedId(backend, value.repo_id),
    source_job_id: value.source_job_id == null ? value.source_job_id : federatedId(backend, value.source_job_id),
    work_item_id: value.work_item_id == null ? value.work_item_id : federatedId(backend, value.work_item_id),
  }
}

function normalizeWorkItem(value: Record<string, unknown>, backend: BackendStatus) {
  const key = value.key
  const resources = Array.isArray(value.resources)
    ? value.resources.map((candidate) => {
        const resource = record(candidate)
        return resource
          ? {
              ...resource,
              repository_id: resource.repository_id == null ? resource.repository_id : federatedId(backend, resource.repository_id),
            }
          : candidate
      })
    : value.resources
  const relations = Array.isArray(value.relations)
    ? value.relations.map((candidate) => {
        const relation = record(candidate)
        return relation
          ? {
              ...relation,
              from_work_item_id: federatedId(backend, relation.from_work_item_id),
              to_work_item_id: federatedId(backend, relation.to_work_item_id),
              key: federatedWorkKey(backend, relation.key),
            }
          : candidate
      })
    : value.relations
  const transfers = Array.isArray(value.context_transfers)
    ? value.context_transfers.map((candidate) => {
        const transfer = record(candidate)
        if (!transfer) return candidate
        const next = { ...transfer }
        for (const field of ['work_item_id', 'source_work_item_id', 'destination_work_item_id', 'source_job_id', 'destination_job_id']) {
          if (next[field] != null) next[field] = federatedId(backend, next[field])
        }
        return next
      })
    : value.context_transfers
  return {
    ...value,
    ...sourceFields(backend, value.id, key),
    id: federatedId(backend, value.id),
    key: federatedWorkKey(backend, key),
    primary_repository_id:
      value.primary_repository_id == null ? value.primary_repository_id : federatedId(backend, value.primary_repository_id),
    resources,
    threads: Array.isArray(value.threads)
      ? value.threads.map((candidate) => {
          const thread = record(candidate)
          return thread ? normalizeJob(thread, backend) : candidate
        })
      : value.threads,
    relations,
    context_transfers: transfers,
  }
}

function normalizePrTask(value: unknown, backend: BackendStatus) {
  const task = record(value)
  if (!task) return value
  return {
    ...task,
    ...sourceFields(backend, task.id),
    id: federatedId(backend, task.id),
    repo_id: federatedId(backend, task.repo_id),
    analysis_job_id: task.analysis_job_id == null ? task.analysis_job_id : federatedId(backend, task.analysis_job_id),
  }
}

function normalizeCleanup(value: unknown, backend: BackendStatus) {
  const cleanup = record(value)
  if (!cleanup) return value
  return {
    ...cleanup,
    ...sourceFields(backend, cleanup.job_id),
    job_id: federatedId(backend, cleanup.job_id),
    repo_id: federatedId(backend, cleanup.repo_id),
  }
}

export function normalizeEntity(value: unknown, backend: BackendStatus): unknown {
  if (Array.isArray(value)) return value.map((candidate) => normalizeEntity(candidate, backend))
  const entity = record(value)
  if (!entity) return value
  if ('key' in entity && 'state' in entity && 'resources' in entity) return normalizeWorkItem(entity, backend)
  if ('repo_id' in entity && 'status' in entity && ('thread_id' in entity || 'agent_id' in entity)) return normalizeJob(entity, backend)
  if ('repo_id' in entity && 'number' in entity && 'base_ref' in entity) return normalizePullRequest(entity, backend)
  if ('full_name' in entity && 'local_path' in entity && 'id' in entity) return normalizeRepository(entity, backend)
  const normalized = Object.fromEntries(Object.entries(entity).map(([key, candidate]) => [key, normalizeEntity(candidate, backend)]))
  if (typeof normalized.destinationJobId === 'number') normalized.destinationJobId = federatedId(backend, normalized.destinationJobId)
  return normalized
}

export function normalizeReadModelEntry(collection: DashboardCollection, entry: ReadModelEntry, backend: BackendStatus): ReadModelEntry {
  const value =
    collection === 'repositories'
      ? normalizeRepository(entry.value, backend)
      : collection === 'pullRequests'
        ? normalizePullRequest(entry.value, backend)
        : collection === 'agentThreads'
          ? normalizeJob(entry.value, backend)
          : collection === 'workItems'
            ? normalizeWorkItem(entry.value, backend)
            : entry.value
  return {
    ...entry,
    key: `${backend.id}:${entry.key}`,
    value,
  }
}

export function mergeDashboardMeta(
  models: Array<{ backend: BackendStatus; payload: ReadModelResponse }>,
  backends: BackendStatus[],
): ReadModelEntry {
  const metadata = models.map(({ backend, payload }) => {
    const update = payload.updates.dashboardMeta
    const entry = update?.entries?.[0] || update?.upserts?.[0]
    return { backend, value: record(entry?.value) || {} }
  })
  const primary = metadata.find(({ backend }) => backend.isDefault)?.value || metadata[0]?.value || {}
  return {
    key: 'current',
    value: {
      ...primary,
      pr_tasks: metadata.flatMap(({ backend, value }) =>
        Array.isArray(value.pr_tasks) ? value.pr_tasks.map((task) => normalizePrTask(task, backend)) : [],
      ),
      cleanup_worktrees: metadata.flatMap(({ backend, value }) =>
        Array.isArray(value.cleanup_worktrees) ? value.cleanup_worktrees.map((item) => normalizeCleanup(item, backend)) : [],
      ),
      backends,
    },
    sourceUpdatedAt: null,
    position: 0,
  }
}

const idBodyFields = new Set([
  'repo_id',
  'repository_id',
  'primary_repository_id',
  'job_id',
  'source_job_id',
  'destination_job_id',
  'analysis_job_id',
  'work_item_id',
  'source_work_item_id',
  'destination_work_item_id',
])

export function denormalizePayload(value: unknown, backend: ApiBackend): unknown {
  if (Array.isArray(value)) return value.map((candidate) => denormalizePayload(candidate, backend))
  const candidate = record(value)
  if (!candidate) return value
  return Object.fromEntries(
    Object.entries(candidate).map(([key, item]) => {
      if (idBodyFields.has(key)) return [key, item == null ? item : localId(item)]
      if (key === 'repository_ids' && Array.isArray(item)) return [key, item.map(localId)]
      if (key === 'work_item_key') return [key, localWorkKey(backend, item)]
      return [key, denormalizePayload(item, backend)]
    }),
  )
}

import type { BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import type { WorkBoardData } from '@vertexade/ui/lib/dashboard-types'

type Repository = WorkBoardData['repositories'][number]

export type WorkRepositoryCapability = {
  backendId: string
  backendName: string
  repositoryId: number | null
  repository: string
}

export type UnifiedWorkRepository = Repository & {
  identity: string
  capabilities: WorkRepositoryCapability[]
}

export type WorkLaunchPlan = {
  backend: BackendDescriptor
  repositoryIds: number[]
  repositoriesToAdd: string[]
}

export function mergeWorkRepositories(current: Repository[], added: Repository[]) {
  const existing = new Set(current.map((repository) => repository.id))
  return [...current, ...added.filter((repository) => !existing.has(repository.id))]
}

function backendForRepository(repository: Repository, backends: BackendDescriptor[]) {
  if (repository.backend_id)
    return (
      backends.find((backend) => backend.id === repository.backend_id) || {
        id: repository.backend_id,
        label: repository.backend_name || repository.backend_id,
        namespace: 0,
        isDefault: false,
        connected: false,
        lastConnectedAt: null,
        error: 'Owning server is unavailable',
        apiPath: `/api/backends/${encodeURIComponent(repository.backend_id)}`,
      }
    )
  return backends.find((backend) => backend.isDefault) || backends[0] || null
}

function serverSpecificRepository(repository: Repository) {
  return repository.source_kind === 'directory' || repository.source_kind === 'workspace'
}

function repositoryOrigin(repository: Repository, backendId: string) {
  const cloneUrl = repository.clone_url?.trim() || ''
  if (!cloneUrl) return `backend:${backendId}`
  try {
    return new URL(cloneUrl).host.toLowerCase()
  } catch {
    return cloneUrl.match(/^[^@]+@([^:]+):/)?.[1]?.toLowerCase() || `backend:${backendId}`
  }
}

function repositoryIdentity(repository: Repository, backendId: string) {
  if (serverSpecificRepository(repository)) return `server:${backendId}:${repository.id}`
  return `scm:${repositoryOrigin(repository, backendId)}:${repository.full_name.trim().toLowerCase()}`
}

export function unifiedWorkRepositories(repositories: Repository[], backends: BackendDescriptor[]): UnifiedWorkRepository[] {
  const groups = new Map<string, Array<{ repository: Repository; backend: BackendDescriptor }>>()
  for (const repository of repositories) {
    const backend = backendForRepository(repository, backends)
    if (!backend) continue
    const identity = repositoryIdentity(repository, backend.id)
    const members = groups.get(identity) || []
    if (!members.some((member) => member.backend.id === backend.id)) members.push({ repository, backend })
    groups.set(identity, members)
  }
  return [...groups.entries()]
    .map(([identity, members]) => {
      const representative = members.find(({ backend }) => backend.isDefault) || members[0]!
      return {
        ...representative.repository,
        identity,
        capabilities: members.map(({ repository, backend }) => ({
          backendId: backend.id,
          backendName: backend.label,
          repositoryId: repository.id,
          repository: repository.full_name,
        })),
      }
    })
    .sort(
      (left, right) =>
        left.full_name.toLowerCase().localeCompare(right.full_name.toLowerCase()) || left.identity.localeCompare(right.identity),
    )
}

export function withDiscoveredWorkCapabilities(
  repositories: UnifiedWorkRepository[],
  capabilities: Array<{ identity: string; backendId: string; backendName: string; repository: string }>,
) {
  return repositories.map((repository) => ({
    ...repository,
    capabilities: [
      ...repository.capabilities,
      ...capabilities
        .filter(
          (capability) =>
            capability.identity === repository.identity &&
            !repository.capabilities.some((current) => current.backendId === capability.backendId),
        )
        .map((capability) => ({ ...capability, repositoryId: null })),
    ],
  }))
}

export function normalizeSelectedRepositoryIds(repositories: UnifiedWorkRepository[], selected: number[]) {
  const selectedSet = new Set(selected)
  return repositories
    .filter(
      (repository) =>
        selectedSet.has(repository.id) ||
        repository.capabilities.some((capability) => capability.repositoryId !== null && selectedSet.has(capability.repositoryId)),
    )
    .map((repository) => repository.id)
}

export function capableWorkBackends(repositories: UnifiedWorkRepository[], selectedRepositoryIds: number[], backends: BackendDescriptor[]) {
  const selected = repositories.filter((repository) => selectedRepositoryIds.includes(repository.id))
  return backends.filter(
    (backend) =>
      backend.connected &&
      selected.every((repository) => repository.capabilities.some((capability) => capability.backendId === backend.id)),
  )
}

export function workLaunchPlans(
  repositories: UnifiedWorkRepository[],
  selectedRepositoryIds: number[],
  targetBackendIds: string[],
  backends: BackendDescriptor[],
): WorkLaunchPlan[] {
  const selected = repositories.filter((repository) => selectedRepositoryIds.includes(repository.id))
  return targetBackendIds.flatMap((backendId) => {
    const backend = backends.find((candidate) => candidate.id === backendId && candidate.connected)
    if (!backend) return []
    const capabilities = selected.map((repository) => repository.capabilities.find((capability) => capability.backendId === backendId))
    if (capabilities.some((capability) => !capability)) return []
    return [
      {
        backend,
        repositoryIds: capabilities.flatMap((capability) => (capability?.repositoryId == null ? [] : [capability.repositoryId])),
        repositoriesToAdd: capabilities.flatMap((capability) => (capability?.repositoryId == null ? [capability!.repository] : [])),
      },
    ]
  })
}

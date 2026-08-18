import { describe, expect, it } from 'vite-plus/test'
import type { BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import type { WorkBoardData } from '@vertexade/ui/lib/dashboard-types'
import {
  capableWorkBackends,
  mergeWorkRepositories,
  normalizeSelectedRepositoryIds,
  unifiedWorkRepositories,
  withDiscoveredWorkCapabilities,
  workLaunchPlans,
} from './work-targets'

const backends: BackendDescriptor[] = [
  {
    id: 'local',
    label: 'Local',
    namespace: 0,
    isDefault: true,
    connected: true,
    lastConnectedAt: null,
    error: null,
    apiPath: '/api',
  },
  {
    id: 'remote',
    label: 'Remote',
    namespace: 1,
    isDefault: false,
    connected: true,
    lastConnectedAt: null,
    error: null,
    apiPath: '/api/backends/remote',
  },
]

const repositories: WorkBoardData['repositories'] = [
  { id: 1, full_name: 'Dovo/VertexADE', backend_id: 'local', backend_name: 'Local', source_kind: 'git' },
  { id: 1_000_002, full_name: 'dovo/vertexade', backend_id: 'remote', backend_name: 'Remote', source_kind: 'git' },
  { id: 3, full_name: 'workspace', backend_id: 'local', backend_name: 'Local', source_kind: 'directory' },
  { id: 1_000_004, full_name: 'workspace', backend_id: 'remote', backend_name: 'Remote', source_kind: 'directory' },
]

describe('unified Work targets', () => {
  it('keeps newly registered repositories available until the federated board catches up', () => {
    const added = { id: 5, full_name: 'Dovo/New', backend_id: 'local', source_kind: 'git' } as (typeof repositories)[number]
    expect(mergeWorkRepositories(repositories, [added])).toContain(added)
    expect(mergeWorkRepositories([...repositories, added], [added]).filter((repository) => repository.id === 5)).toHaveLength(1)
  })

  it('groups the same SCM repository while keeping directories server-specific', () => {
    const unified = unifiedWorkRepositories(repositories, backends)
    expect(unified).toHaveLength(3)
    expect(unified.find((repository) => repository.id === 1)?.capabilities).toEqual([
      { backendId: 'local', backendName: 'Local', repositoryId: 1, repository: 'Dovo/VertexADE' },
      { backendId: 'remote', backendName: 'Remote', repositoryId: 1_000_002, repository: 'dovo/vertexade' },
    ])
  })

  it('normalizes a remembered server-specific repository to its logical project', () => {
    const unified = unifiedWorkRepositories(repositories, backends)
    expect(normalizeSelectedRepositoryIds(unified, [1_000_002])).toEqual([1])
  })

  it('offers every connected server that can initialize all selected projects', () => {
    const unified = unifiedWorkRepositories(repositories, backends)
    expect(capableWorkBackends(unified, [1], backends).map((backend) => backend.id)).toEqual(['local', 'remote'])
    expect(capableWorkBackends(unified, [3], backends).map((backend) => backend.id)).toEqual(['local'])
  })

  it('maps a logical project back to each server-owned repository record', () => {
    const unified = unifiedWorkRepositories(repositories, backends)
    expect(workLaunchPlans(unified, [1], ['local', 'remote'], backends)).toEqual([
      { backend: backends[0], repositoryIds: [1], repositoriesToAdd: [] },
      { backend: backends[1], repositoryIds: [1_000_002], repositoriesToAdd: [] },
    ])
  })

  it('can initialize a repository on a server that authenticates it but has not registered it yet', () => {
    const localOnly = unifiedWorkRepositories([repositories[0]!], backends)
    const unified = withDiscoveredWorkCapabilities(localOnly, [
      { identity: localOnly[0]!.identity, backendId: 'remote', backendName: 'Remote', repository: 'Dovo/VertexADE' },
    ])
    expect(capableWorkBackends(unified, [1], backends).map((backend) => backend.id)).toEqual(['local', 'remote'])
    expect(workLaunchPlans(unified, [1], ['remote'], backends)).toEqual([
      { backend: backends[1], repositoryIds: [], repositoriesToAdd: ['Dovo/VertexADE'] },
    ])
  })
})

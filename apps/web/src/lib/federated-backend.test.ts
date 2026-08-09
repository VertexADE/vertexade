import { describe, expect, it } from 'vite-plus/test'
import type { ApiBackend } from './api-backend'
import { denormalizePayload, federatedId, localId, normalizeEntity, normalizeReadModelEntry } from './federated-backend'

const backend: ApiBackend = {
  id: 'team',
  label: 'Team',
  url: 'https://team.internal',
  namespace: 2,
  isDefault: false,
}
const status = { ...backend, connected: true, lastConnectedAt: '2026-08-05T10:00:00.000Z', error: null }

describe('federated backend identities', () => {
  it('round-trips numeric ids inside a backend namespace', () => {
    expect(federatedId(backend, 42)).toBe(2_000_000_042)
    expect(localId(2_000_000_042)).toBe(42)
  })

  it('namespaces work records and their routed relationships', () => {
    expect(
      normalizeEntity(
        {
          id: 7,
          key: 'W-0007',
          title: 'Ship it',
          state: 'active',
          primary_repository_id: 4,
          resources: [{ id: 9, repository_id: 4 }],
          threads: [{ id: 11, repo_id: 4, status: 'running', kind: 'task', thread_id: 'thread-1', work_item_id: 7 }],
          relations: [{ from_work_item_id: 7, to_work_item_id: 8, key: 'W-0008' }],
          context_transfers: [],
        },
        status,
      ),
    ).toMatchObject({
      id: 2_000_000_007,
      key: 'team~W-0007',
      backend_id: 'team',
      backend_name: 'Team',
      backend_local_key: 'W-0007',
      primary_repository_id: 2_000_000_004,
      resources: [{ id: 9, repository_id: 2_000_000_004 }],
      threads: [{ id: 2_000_000_011, repo_id: 2_000_000_004, work_item_id: 2_000_000_007 }],
      relations: [{ from_work_item_id: 2_000_000_007, to_work_item_id: 2_000_000_008, key: 'team~W-0008' }],
    })
  })

  it('uses source-qualified read-model keys', () => {
    expect(
      normalizeReadModelEntry(
        'repositories',
        { key: '4', value: { id: 4, full_name: 'acme/api', local_path: '/repos/api' }, sourceUpdatedAt: null, position: 0 },
        status,
      ),
    ).toMatchObject({ key: 'team:4', value: { id: 2_000_000_004, backend_id: 'team' } })
  })

  it('restores local ids before a request reaches its backend', () => {
    expect(
      denormalizePayload(
        {
          repository_ids: [2_000_000_004, 2_000_000_005],
          source_job_id: 2_000_000_011,
          work_item_key: 'team~W-0007',
        },
        backend,
      ),
    ).toEqual({ repository_ids: [4, 5], source_job_id: 11, work_item_key: 'W-0007' })
  })
})

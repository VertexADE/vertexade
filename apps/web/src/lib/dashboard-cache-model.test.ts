import { describe, expect, it } from 'vite-plus/test'

import { normalizeDashboardCollectionValues } from './dashboard-cache-model'

describe('dashboard cache model compatibility', () => {
  it('fills every Work collection array omitted by an older cached document', () => {
    const [normalized] = normalizeDashboardCollectionValues('workItems', [{ id: 1, title: 'Stale work' }])

    expect(normalized).toEqual({
      id: 1,
      title: 'Stale work',
      repository_names: [],
      resources: [],
      threads: [],
      events: [],
      relations: [],
      context_transfers: [],
    })
  })

  it('does not clone current documents or unrelated collections', () => {
    const workItem = {
      id: 1,
      repository_names: [],
      resources: [],
      threads: [],
      events: [],
      relations: [],
      context_transfers: [],
    }
    const repository = { id: 1, full_name: 'vertexade/app' }

    expect(normalizeDashboardCollectionValues('workItems', [workItem])[0]).toBe(workItem)
    expect(normalizeDashboardCollectionValues('repositories', [repository])[0]).toBe(repository)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { WorkBoardData, WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { readWorkLaunchPreferences, rememberWorkLaunchPreferences, suggestedWorkRepositories } from './new-work-service'

describe('work launch preferences', () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it('remembers the last successful workspace and delivery defaults', () => {
    rememberWorkLaunchPreferences({ repositories: [3, 1], createPr: false, splitWorkItem: true })
    expect(readWorkLaunchPreferences()).toEqual({ repositories: [3, 1], createPr: false, splitWorkItem: true })
  })

  it('does not replace a useful workspace with an empty planning choice', () => {
    rememberWorkLaunchPreferences({ repositories: [3], createPr: true, splitWorkItem: false })
    rememberWorkLaunchPreferences({ repositories: [], createPr: false, splitWorkItem: true })
    expect(readWorkLaunchPreferences().repositories).toEqual([3])
  })

  it('recovers safely from corrupt browser storage', () => {
    values.set('vertexade.work-launch-preferences', '{broken')
    expect(readWorkLaunchPreferences()).toEqual({ repositories: [], createPr: true, splitWorkItem: false })
  })
})

describe('suggested work repositories', () => {
  const item = (id: number, repositoryId: number, updatedAt: string, archived = false) =>
    ({
      id,
      primary_repository_id: repositoryId,
      updated_at: updatedAt,
      archived_at: archived ? updatedAt : null,
    }) as WorkItem
  const data = {
    repositories: [
      { id: 1, full_name: 'acme/api' },
      { id: 2, full_name: 'acme/web' },
    ],
    items: [item(1, 1, '2026-08-01T10:00:00Z'), item(2, 2, '2026-08-03T10:00:00Z')],
  } satisfies WorkBoardData

  it('prefers a valid draft or remembered workspace', () => {
    expect(suggestedWorkRepositories(data, [1], [2])).toEqual([1])
    expect(suggestedWorkRepositories(data, [99], [1])).toEqual([1])
  })

  it('suggests the most recently used active workspace on first launch', () => {
    expect(suggestedWorkRepositories(data)).toEqual([2])
  })
})

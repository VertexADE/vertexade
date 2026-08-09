import { describe, expect, it } from 'vite-plus/test'
import type { WorkItem } from './dashboard-types'
import { sortWorkItems, workItemActivityAt, type WorkItemSort } from './work-sort'

function item(id: number, overrides: Partial<WorkItem> = {}) {
  return {
    id,
    title: `Work ${id}`,
    priority: 'normal',
    state: 'active',
    created_at: `2026-07-${String(id).padStart(2, '0')}T10:00:00Z`,
    updated_at: `2026-07-${String(id).padStart(2, '0')}T10:00:00Z`,
    threads: [],
    events: [],
    context_transfers: [],
    ...overrides,
  } as unknown as WorkItem
}

function sortedIds(items: WorkItem[], sort: WorkItemSort) {
  return sortWorkItems(items, sort).map(({ id }) => id)
}

describe('work item sorting', () => {
  it('sorts by recent or oldest meaningful activity without mutating the API result', () => {
    const items = [
      item(1, { updated_at: '2026-07-24T10:00:00Z' }),
      item(2, { updated_at: '2026-07-26T10:00:00Z' }),
      item(3, {
        updated_at: '2026-07-23T10:00:00Z',
        threads: [
          {
            created_at: '2026-07-23T10:00:00Z',
            activity_at: '2026-07-25T10:00:00Z',
            finished_at: null,
          },
        ] as WorkItem['threads'],
      }),
    ]

    expect(sortedIds(items, 'recent')).toEqual([2, 3, 1])
    expect(sortedIds(items, 'oldest')).toEqual([1, 3, 2])
    expect(items.map(({ id }) => id)).toEqual([1, 2, 3])
  })

  it('sorts priority in both directions and uses recent activity for equal priorities', () => {
    const items = [
      item(1, { priority: 'normal' }),
      item(2, { priority: 'urgent' }),
      item(3, { priority: 'low' }),
      item(4, { priority: 'urgent' }),
    ]

    expect(sortedIds(items, 'priority-high')).toEqual([4, 2, 1, 3])
    expect(sortedIds(items, 'priority-low')).toEqual([3, 1, 4, 2])
  })

  it('sorts creation time in both directions', () => {
    const items = [item(1), item(3), item(2)]

    expect(sortedIds(items, 'created-newest')).toEqual([3, 2, 1])
    expect(sortedIds(items, 'created-oldest')).toEqual([1, 2, 3])
  })

  it('sorts titles naturally and case-insensitively in both directions', () => {
    const items = [item(1, { title: 'Work 10' }), item(2, { title: 'alpha' }), item(3, { title: 'Work 2' })]

    expect(sortedIds(items, 'title-asc')).toEqual([2, 3, 1])
    expect(sortedIds(items, 'title-desc')).toEqual([1, 3, 2])
  })

  it('sorts status by lifecycle and recent activity within each status', () => {
    const items = [
      item(1, { state: 'done' }),
      item(2, { state: 'active' }),
      item(3, { state: 'backlog' }),
      item(4, { state: 'active' }),
      item(5, { state: 'review' }),
      item(6, { state: 'deploy' }),
    ]

    expect(sortedIds(items, 'status')).toEqual([3, 4, 2, 5, 6, 1])
  })

  it('uses activity from jobs, timeline events, and context transfers', () => {
    const value = item(4, {
      updated_at: '2026-07-20T10:00:00Z',
      threads: [
        {
          created_at: '2026-07-21T10:00:00Z',
          activity_at: '2026-07-22T10:00:00Z',
          finished_at: null,
        },
      ] as WorkItem['threads'],
      events: [
        {
          id: 1,
          event_type: 'updated',
          summary: '',
          actor: 'system',
          payload: {},
          created_at: '2026-07-23T10:00:00Z',
        },
      ],
      context_transfers: [
        {
          id: 1,
          work_item_id: 4,
          source_work_item_id: null,
          destination_work_item_id: null,
          source_job_id: null,
          destination_job_id: null,
          status: 'completed',
          instruction: '',
          context_size: 0,
          output_captured: 0,
          error: null,
          created_at: '2026-07-21T10:00:00Z',
          started_at: '2026-07-24T10:00:00Z',
          finished_at: '2026-07-25T10:00:00Z',
        },
      ],
    })

    expect(workItemActivityAt(value)).toBe('2026-07-25T10:00:00Z')
  })
})

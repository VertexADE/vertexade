import { describe, expect, it } from 'vite-plus/test'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { applyPendingWorkStates, workStateFromDropTarget } from './work-board-stage'

function workItem(id: number, state: WorkItem['state']): WorkItem {
  return { id, state } as WorkItem
}

describe('work board stage helpers', () => {
  it('recognizes only lifecycle column drop targets', () => {
    expect(workStateFromDropTarget('review')).toBe('review')
    expect(workStateFromDropTarget('filters')).toBeNull()
    expect(workStateFromDropTarget(42)).toBeNull()
    expect(workStateFromDropTarget(null)).toBeNull()
  })

  it('applies optimistic moves without mutating cached work items', () => {
    const items = [workItem(1, 'backlog'), workItem(2, 'active')]
    const moved = applyPendingWorkStates(items, new Map([[1, 'review']]))

    expect(moved.map((item) => item.state)).toEqual(['review', 'active'])
    expect(items.map((item) => item.state)).toEqual(['backlog', 'active'])
    expect(moved[1]).toBe(items[1])
  })

  it('reuses the cached collection when no moves are pending', () => {
    const items = [workItem(1, 'backlog')]
    expect(applyPendingWorkStates(items, new Map())).toBe(items)
  })
})

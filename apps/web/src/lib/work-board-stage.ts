import type { WorkItem, WorkState } from '@vertexade/ui/lib/dashboard-types'

export const workStateOrder = ['backlog', 'active', 'review', 'deploy', 'done'] as const satisfies readonly WorkState[]

export const workStateLabels: Record<WorkState, string> = {
  backlog: 'Backlog',
  active: 'Active',
  review: 'Review',
  deploy: 'Deploy',
  done: 'Done',
}

export function workStateFromDropTarget(target: string | number | null | undefined): WorkState | null {
  return workStateOrder.find((state) => state === target) ?? null
}

export function applyPendingWorkStates(items: readonly WorkItem[], pending: ReadonlyMap<number, WorkState>) {
  if (!pending.size) return items
  return items.map((item) => {
    const state = pending.get(item.id)
    return state && state !== item.state ? { ...item, state } : item
  })
}

import { useMemo, useState } from 'react'
import { PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { toast } from 'sonner'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem, WorkState } from '@vertexade/ui/lib/dashboard-types'
import { applyPendingWorkStates, workStateFromDropTarget, workStateLabels } from '../../lib/work-board-stage'
import { preventBlockedWorkCompletion } from '../../lib/work-completion'

function skipWorkStageMove(item: WorkItem, state: WorkState, moving: boolean) {
  if (state === item.state || moving) return true
  return preventBlockedWorkCompletion(item, state, toast.info)
}

export function useWorkStageMoves(items: readonly WorkItem[], refresh: () => Promise<unknown>) {
  const [pendingStates, setPendingStates] = useState<ReadonlyMap<number, WorkState>>(() => new Map())
  const [movingIds, setMovingIds] = useState<ReadonlySet<number>>(() => new Set())
  const [draggedItem, setDraggedItem] = useState<WorkItem | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const presentedItems = useMemo(() => applyPendingWorkStates(items, pendingStates), [items, pendingStates])

  async function moveWorkItem(item: WorkItem, state: WorkState) {
    if (skipWorkStageMove(item, state, movingIds.has(item.id))) return
    setPendingStates((current) => new Map(current).set(item.id, state))
    setMovingIds((current) => new Set(current).add(item.id))
    try {
      await api<WorkItem>(`/api/work-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          state,
          reason: `Moved from ${workStateLabels[item.state]} to ${workStateLabels[state]} on the Work board`,
        }),
      })
      await refresh()
      toast.success(`${item.key} moved to ${workStateLabels[state]}`)
    } catch (error) {
      toast.error(`Could not move ${item.key}: ${(error as Error).message}`)
    } finally {
      setPendingStates((current) => {
        const next = new Map(current)
        next.delete(item.id)
        return next
      })
      setMovingIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  function startDrag(event: DragStartEvent) {
    const itemId = Number(event.active.id)
    setDraggedItem(presentedItems.find((item) => item.id === itemId) ?? null)
  }

  function finishDrag(event: DragEndEvent) {
    const item = draggedItem
    const state = workStateFromDropTarget(event.over?.id)
    setDraggedItem(null)
    if (item && state) void moveWorkItem(item, state)
  }

  return {
    draggedItem,
    finishDrag,
    moveWorkItem,
    movingIds,
    presentedItems,
    sensors,
    startDrag,
    cancelDrag: () => setDraggedItem(null),
  }
}

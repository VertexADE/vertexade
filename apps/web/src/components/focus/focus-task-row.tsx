import type { DragEvent, KeyboardEvent } from 'react'
import { GripVertical } from 'lucide-react'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { displayBackendKey } from '@vertexade/ui/lib/backend-registry'
import { cn } from '@vertexade/ui/lib/utils'
import { FocusTaskDetails } from './focus-task-details'
import { FocusTaskRowContent } from './focus-task-row-content'
import { acceptanceChecks, focusTaskBlocker } from './focus-task-model'
import { WorkCardMenu } from '../work/work-card-menu'
import { useIsMobile } from '@vertexade/ui/hooks/use-mobile'

type FocusTaskRowProps = {
  item: WorkItem
  expanded: boolean
  dragging: boolean
  completing: boolean
  previousId?: number
  nextId?: number
  onExpand: () => void
  onComplete: () => void
  onDelegate: () => void
  onArchive: () => void
  onDelete: () => void
  onDragStart: (id: number) => void
  onDragEnd: () => void
  onMove: (activeId: number, overId: number) => void
}

export function FocusTaskRow(props: FocusTaskRowProps) {
  const { item, expanded, dragging, completing, previousId, nextId } = props
  const checks = acceptanceChecks(item.description)
  const isMobile = useIsMobile()

  function startDrag(event: DragEvent<HTMLButtonElement>) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(item.id))
    props.onDragStart(item.id)
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    const activeId = Number(event.dataTransfer.getData('text/plain'))
    if (Number.isFinite(activeId)) props.onMove(activeId, item.id)
    props.onDragEnd()
  }

  function reorderWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const target = event.key === 'ArrowUp' ? previousId : event.key === 'ArrowDown' ? nextId : undefined
    if (!target) return
    event.preventDefault()
    props.onMove(item.id, target)
  }

  return (
    <article
      className={cn(
        'group relative bg-background transition-colors hover:bg-muted',
        dragging && 'z-10 rounded-md bg-card opacity-70 shadow-lg ring-1 ring-primary/40',
      )}
      onDragOver={(event) => {
        if (!isMobile) event.preventDefault()
      }}
      onDrop={isMobile ? undefined : drop}
    >
      <WorkCardMenu item={item} onArchive={props.onArchive} onDelete={props.onDelete} />
      <div className="flex min-w-0 items-start gap-2.5 p-2.5 sm:gap-3 sm:p-3 lg:items-center lg:py-2.5">
        <button
          type="button"
          draggable={!isMobile}
          className="hidden size-7 shrink-0 touch-none place-items-center rounded-md text-muted-foreground/60 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid"
          aria-label={`Reorder ${displayBackendKey(item, item.key)}. Use arrow keys or drag.`}
          onDragStart={startDrag}
          onDragEnd={props.onDragEnd}
          onKeyDown={reorderWithKeyboard}
        >
          <GripVertical className="size-3.5" />
        </button>
        <FocusTaskRowContent
          item={item}
          checks={checks}
          completing={completing}
          expanded={expanded}
          onComplete={props.onComplete}
          onDelegate={props.onDelegate}
          onExpand={props.onExpand}
        />
      </div>
      {expanded && <FocusTaskDetails item={item} checks={checks} blocker={focusTaskBlocker(item)} onDelegate={props.onDelegate} />}
    </article>
  )
}

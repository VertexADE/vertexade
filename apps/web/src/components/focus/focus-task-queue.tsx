import { useMemo, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { buildFocusTaskGroups, reorderFocusTasks, type FocusTaskGroup } from './focus-task-model'
import { FocusTaskSection, type FocusTaskSectionControls } from './focus-task-section'

type FocusTaskQueueProps = {
  items: WorkItem[]
  savedOrder: number[]
  loading: boolean
  completingId: number | null
  readyInDesktopRail?: boolean
  embedded?: boolean
  onOrderChange: (order: number[]) => void
  onComplete: (item: WorkItem) => void
  onDelegate: (item: WorkItem) => void
  onArchive: (item: WorkItem) => void
  onDelete: (item: WorkItem) => void
}

export function FocusTaskQueue(props: FocusTaskQueueProps) {
  const { items, savedOrder } = props
  const groups = useMemo(() => buildFocusTaskGroups(items, savedOrder), [items, savedOrder])
  const visibleGroups = groups.filter((group) => group.items.length).sort((left, right) => groupRank[left.id] - groupRank[right.id])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)

  const visibleIds = new Set(groups.flatMap((group) => group.items.map((item) => item.id)))
  const visibleExpandedId = expandedId && visibleIds.has(expandedId) ? expandedId : null

  function move(activeId: number, overId: number) {
    const next = reorderFocusTasks(items, savedOrder, activeId, overId)
    if (next !== savedOrder) props.onOrderChange(next)
  }

  if (props.loading) {
    return <FocusTaskQueueLoading />
  }

  return (
    <FocusTaskGroups
      groups={visibleGroups}
      expandedId={visibleExpandedId}
      draggingId={draggingId}
      completingId={props.completingId}
      onExpand={setExpandedId}
      onComplete={props.onComplete}
      onDelegate={props.onDelegate}
      onArchive={props.onArchive}
      onDelete={props.onDelete}
      onDragStart={setDraggingId}
      onDragEnd={() => setDraggingId(null)}
      onMove={move}
      readyInDesktopRail={props.readyInDesktopRail}
      embedded={props.embedded}
    />
  )
}

function FocusTaskQueueLoading() {
  return (
    <div className="grid min-h-40 place-items-center text-xs text-muted-foreground">
      <span>
        <Loader2 className="mr-2 inline size-4 animate-spin" />
        Loading task queue…
      </span>
    </div>
  )
}

type FocusTaskGroupsProps = FocusTaskSectionControls & {
  groups: FocusTaskGroup[]
  readyInDesktopRail?: boolean
  embedded?: boolean
}

function FocusTaskGroups({ groups, readyInDesktopRail, embedded, ...props }: FocusTaskGroupsProps) {
  if (!groups.length) return <FocusTaskQueueEmpty embedded={embedded} />
  return (
    <div data-focus-queue className={embedded ? 'space-y-3 sm:space-y-0 sm:divide-y sm:divide-border/55' : 'space-y-3 pb-3'}>
      {groups.map((group) => (
        <FocusTaskSection
          key={group.id}
          group={group}
          desktopHidden={readyInDesktopRail && group.id === 'ready'}
          embedded={embedded}
          {...props}
        />
      ))}
    </div>
  )
}

function FocusTaskQueueEmpty({ embedded = false }: { embedded?: boolean }) {
  return (
    <section data-focus-queue className={cn('bg-card/10 px-4 py-12 text-center', !embedded && 'rounded-xl border')}>
      <CheckCircle2 className="mx-auto size-6 text-emerald-400" />
      <h2 className="mt-3 text-sm font-semibold">Your focus queue is clear</h2>
      <p className="mt-1 text-xs text-muted-foreground">New active and ready work will appear here.</p>
    </section>
  )
}

const groupRank = { now: 0, blocked: 1, ready: 2 } satisfies Record<FocusTaskGroup['id'], number>

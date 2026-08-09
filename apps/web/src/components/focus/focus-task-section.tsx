import { useState } from 'react'
import { GripVertical } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import type { FocusTaskGroup } from './focus-task-model'
import { FocusTaskRow } from './focus-task-row'

export type FocusTaskSectionControls = {
  expandedId: number | null
  draggingId: number | null
  completingId: number | null
  onExpand: (id: number) => void
  onComplete: (item: WorkItem) => void
  onDelegate: (item: WorkItem) => void
  onArchive: (item: WorkItem) => void
  onDelete: (item: WorkItem) => void
  onDragStart: (id: number) => void
  onDragEnd: () => void
  onMove: (activeId: number, overId: number) => void
}

type FocusTaskSectionProps = FocusTaskSectionControls & {
  group: FocusTaskGroup
  desktopHidden?: boolean
  embedded?: boolean
}

export function FocusTaskSection(props: FocusTaskSectionProps) {
  const { group, desktopHidden, embedded } = props
  const [showAll, setShowAll] = useState(false)
  const visibleItems = visibleFocusItems(group.items, showAll)
  const hiddenCount = group.items.length - visibleItems.length

  return (
    <section
      aria-labelledby={`focus-${group.id}`}
      className={cn(
        'overflow-hidden bg-card',
        embedded ? 'rounded-lg border sm:rounded-none sm:border-0' : 'rounded-md border',
        desktopHidden && 'xl:hidden',
      )}
    >
      <FocusTaskSectionHeader group={group} embedded={embedded} />
      <FocusTaskColumnHeader />
      <FocusTaskRows
        {...props}
        visibleItems={visibleItems}
        hiddenCount={hiddenCount}
        showAll={showAll}
        onShowAll={() => setShowAll((value) => !value)}
      />
    </section>
  )
}

function FocusTaskColumnHeader() {
  return (
    <div
      aria-hidden="true"
      className="hidden grid-cols-[1.75rem_minmax(0,1.8fr)_minmax(10rem,0.7fr)_5rem_auto_3.5rem] gap-3 border-b bg-muted px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground lg:grid"
    >
      <span />
      <span>Work</span>
      <span>Context</span>
      <span>Updated</span>
      <span className="text-right">Actions</span>
      <span />
    </div>
  )
}

function FocusTaskSectionHeader({ group, embedded }: { group: FocusTaskGroup; embedded?: boolean }) {
  return (
    <header className={cn('flex items-center gap-2 border-b px-3 py-2', embedded && 'bg-muted sm:px-4')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 id={`focus-${group.id}`} className="text-sm font-semibold">
            {group.label}
          </h2>
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
            {group.items.length}
          </Badge>
        </div>
        <p className="sr-only">{group.description}</p>
      </div>
      {group.items.length > 1 && (
        <span className="hidden items-center gap-1 text-[11px] text-muted-foreground lg:flex">
          <GripVertical className="size-3" />
          Drag to prioritize
        </span>
      )}
    </header>
  )
}

function FocusTaskRows({
  group,
  visibleItems,
  hiddenCount,
  showAll,
  onShowAll,
  ...props
}: FocusTaskSectionProps & {
  visibleItems: WorkItem[]
  hiddenCount: number
  showAll: boolean
  onShowAll: () => void
}) {
  const showToggle = shouldShowToggle(hiddenCount, showAll, group.items.length)
  return (
    <div className="divide-y">
      {visibleItems.map((item, index) => (
        <FocusTaskRowAtIndex key={item.id} item={item} items={visibleItems} index={index} controls={props} />
      ))}
      {showToggle && (
        <div className="px-3 py-2 text-center">
          <Button type="button" variant="ghost" size="xs" onClick={onShowAll}>
            {focusTaskToggleLabel(showAll, hiddenCount, group.label)}
          </Button>
        </div>
      )}
    </div>
  )
}

function FocusTaskRowAtIndex({
  item,
  items,
  index,
  controls,
}: {
  item: WorkItem
  items: WorkItem[]
  index: number
  controls: FocusTaskSectionControls
}) {
  return (
    <FocusTaskRow
      item={item}
      expanded={controls.expandedId === item.id}
      dragging={controls.draggingId === item.id}
      completing={controls.completingId === item.id}
      onExpand={() => controls.onExpand(item.id)}
      onComplete={() => controls.onComplete(item)}
      onDelegate={() => controls.onDelegate(item)}
      onArchive={() => controls.onArchive(item)}
      onDelete={() => controls.onDelete(item)}
      onDragStart={controls.onDragStart}
      onDragEnd={controls.onDragEnd}
      onMove={controls.onMove}
      previousId={items[index - 1]?.id}
      nextId={items[index + 1]?.id}
    />
  )
}

function shouldShowToggle(hiddenCount: number, showAll: boolean, itemCount: number) {
  if (hiddenCount > 0) return true
  return showAll && itemCount > 5
}

function focusTaskToggleLabel(showAll: boolean, hiddenCount: number, label: string) {
  if (showAll) return 'Show less'
  return `Show ${hiddenCount} more ${label.toLowerCase()}`
}

function visibleFocusItems(items: WorkItem[], showAll: boolean) {
  if (showAll) return items
  return items.slice(0, 5)
}

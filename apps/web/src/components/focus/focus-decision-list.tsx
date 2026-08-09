import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { FocusDecisionCard } from './focus-decision-card'

export function FocusDecisionList({
  items,
  className,
  desktopRows = false,
  embedded = false,
  onDelegate,
  onArchive,
  onDelete,
  onDismiss,
  onPriority,
  onResolve,
  onSnooze,
}: {
  items: WorkItem[]
  className?: string
  desktopRows?: boolean
  embedded?: boolean
  onDelegate?: (item: WorkItem) => void
  onArchive: (item: WorkItem) => void
  onDelete: (item: WorkItem) => void
  onDismiss: (item: WorkItem) => void
  onPriority: (item: WorkItem, priority: WorkItem['priority']) => void
  onResolve: (item: WorkItem) => void
  onSnooze: (item: WorkItem, until: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  if (!items.length) return null
  const visibleItems = showAll ? items : items.slice(0, 3)

  return (
    <section
      data-focus-decisions
      className={cn(
        'overflow-hidden border-warning/25 bg-warning/[.04]',
        embedded ? 'rounded-lg border sm:rounded-none sm:border-x-0 sm:border-t-0' : 'rounded-md border',
        className,
      )}
    >
      <FocusDecisionHeader count={items.length} embedded={embedded} />
      <div className={focusDecisionGridClass(desktopRows || embedded)}>
        {visibleItems.map((item, index) => (
          <FocusDecisionCard
            key={item.id}
            item={item}
            desktopRow={desktopRows || embedded}
            onDelegate={onDelegate}
            onArchive={onArchive}
            onDelete={onDelete}
            onDismiss={onDismiss}
            onPriority={onPriority}
            onResolve={onResolve}
            onSnooze={onSnooze}
            className={focusDecisionItemClass(desktopRows || embedded, visibleItems.length, index)}
          />
        ))}
      </div>
      <FocusDecisionToggle count={items.length} showAll={showAll} onToggle={() => setShowAll((value) => !value)} />
    </section>
  )
}

function FocusDecisionHeader({ count, embedded }: { count: number; embedded: boolean }) {
  return (
    <header className={cn('flex items-center gap-2 border-b border-warning/20 px-3 py-2', embedded && 'sm:px-4')}>
      <CircleAlert className="size-3.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Decisions</h2>
          <Badge variant="outline" className="h-5 border-warning/30 px-1.5 text-[11px] text-warning">
            {count}
          </Badge>
        </div>
        <p className="sr-only">Decisions that are holding back active work.</p>
      </div>
    </header>
  )
}

function FocusDecisionToggle({ count, showAll, onToggle }: { count: number; showAll: boolean; onToggle: () => void }) {
  if (count <= 3) return null
  return (
    <div className="border-t px-3 py-2 text-center">
      <Button type="button" variant="ghost" size="xs" onClick={onToggle}>
        {showAll ? 'Show priority decisions' : `View all ${count} decisions`}
      </Button>
    </div>
  )
}

function focusDecisionGridClass(desktopRows: boolean) {
  return cn('grid gap-px bg-border', desktopRows ? 'md:grid-cols-1' : 'md:grid-cols-2 xl:grid-cols-3')
}

function focusDecisionItemClass(desktopRows: boolean, count: number, index: number) {
  const isLastOddItem = !desktopRows && count % 2 === 1 && index === count - 1
  return isLastOddItem ? 'md:col-span-2 xl:col-span-1' : undefined
}

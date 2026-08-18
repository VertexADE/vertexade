import { CircleHelp, History, ListTodo, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { Job } from '@vertexade/ui/lib/dashboard-types'
import { buildThreadSections, type ThreadSectionId, type ThreadSort } from '@vertexade/ui/lib/thread-priority'
import { cn } from '@vertexade/ui/lib/utils'
import { ThreadRailItem, ThreadRow } from './thread-components'

const sectionPresentation = {
  input: {
    icon: CircleHelp,
    className: 'text-amber-400',
  },
  action: {
    icon: TriangleAlert,
    className: 'text-red-400',
  },
  active: {
    icon: LoaderCircle,
    className: 'text-blue-400',
  },
  queued: {
    icon: ListTodo,
    className: 'text-violet-400',
  },
  history: {
    icon: History,
    className: 'text-muted-foreground',
  },
  all: {
    icon: History,
    className: 'text-muted-foreground',
  },
} satisfies Record<ThreadSectionId, { icon: typeof History; className: string }>

export type ThreadListActions = {
  onOpen(thread: Job): void
  onDetails(thread: Job): void
  onFork(thread: Job): void
  onDeleting(thread: Job): void
  onDeleteFailed(thread: Job): void
  onChanged(): void
}

export function ThreadQueueList({
  threads,
  sort,
  variant,
  selectedId,
  actions,
}: {
  threads: Job[]
  sort: ThreadSort
  variant: 'rail' | 'cards'
  selectedId?: number
  actions: ThreadListActions
}) {
  const sections = buildThreadSections(threads, sort)

  return (
    <div className={variant === 'rail' ? 'pb-2' : 'space-y-3'}>
      {sections.map((section) => {
        const presentation = sectionPresentation[section.id]
        const Icon = presentation.icon
        const rows = section.threads.map((thread) => {
          const rowActions = {
            job: thread,
            onDetails: () => actions.onDetails(thread),
            onFork: () => actions.onFork(thread),
            onChanged: actions.onChanged,
            onDeleting: () => actions.onDeleting(thread),
            onDeleteFailed: () => actions.onDeleteFailed(thread),
          }
          return variant === 'rail' ? (
            <ThreadRailItem key={thread.id} {...rowActions} selected={selectedId === thread.id} onSelect={() => actions.onOpen(thread)} />
          ) : (
            <ThreadRow key={thread.id} {...rowActions} onChat={() => actions.onOpen(thread)} />
          )
        })
        if (section.id === 'history') {
          return (
            <div key={section.id} data-thread-section={section.id} className={variant === 'rail' ? 'px-1.5' : 'space-y-1.5'}>
              {rows}
            </div>
          )
        }
        return (
          <section key={section.id} data-thread-section={section.id} aria-labelledby={`thread-section-${variant}-${section.id}`}>
            <header
              className={cn(
                'flex min-w-0 items-start gap-2',
                variant === 'rail' ? 'sticky top-0 z-10 bg-background/90 px-2.5 pb-1 pt-2 backdrop-blur' : 'mb-2 px-1',
              )}
            >
              <Icon className={cn('mt-0.5 size-3.5 shrink-0', presentation.className)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <h2 id={`thread-section-${variant}-${section.id}`} className="text-xs font-semibold">
                    {section.label}
                  </h2>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{section.threads.length}</span>
                </span>
                <span className={variant === 'rail' ? 'sr-only' : 'block truncate text-[10px] text-muted-foreground'}>
                  {section.description}
                </span>
              </span>
            </header>
            <div className={variant === 'rail' ? 'px-1.5' : 'space-y-1.5'}>{rows}</div>
          </section>
        )
      })}
    </div>
  )
}

import { CheckCircle2, CircleAlert, CircleHelp, History, ListTodo, LoaderCircle, Radio, TriangleAlert } from 'lucide-react'
import type { Job } from '@vertexade/ui/lib/dashboard-types'
import { buildThreadSections, type ThreadPriorityStats, type ThreadSectionId, type ThreadSort } from '@vertexade/ui/lib/thread-priority'
import { cn } from '@vertexade/ui/lib/utils'
import { ThreadRailItem, ThreadRow, type StatusFilter } from './thread-components'

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

const summaryItems = [
  {
    id: 'attention',
    label: 'Handle now',
    icon: CircleAlert,
    value: (stats: ThreadPriorityStats) => stats.attention,
    detail: (stats: ThreadPriorityStats) => `${stats.input} input · ${stats.action} to review`,
    activeClass: 'bg-amber-500/[.09]',
    iconClass: 'bg-amber-500/10 text-amber-400',
  },
  {
    id: 'active',
    label: 'In progress',
    icon: Radio,
    value: (stats: ThreadPriorityStats) => stats.active,
    detail: () => 'Agents working now',
    activeClass: 'bg-blue-500/[.09]',
    iconClass: 'bg-blue-500/10 text-blue-400',
  },
  {
    id: 'queued',
    label: 'Queued next',
    icon: ListTodo,
    value: (stats: ThreadPriorityStats) => stats.queued,
    detail: () => 'Waiting instructions',
    activeClass: 'bg-violet-500/[.09]',
    iconClass: 'bg-violet-500/10 text-violet-400',
  },
] satisfies Array<{
  id: StatusFilter
  label: string
  icon: typeof History
  value(stats: ThreadPriorityStats): number
  detail(stats: ThreadPriorityStats): string
  activeClass: string
  iconClass: string
}>

export function ThreadPrioritySummary({
  stats,
  activeFilter,
  onFilter,
}: {
  stats: ThreadPriorityStats
  activeFilter: StatusFilter
  onFilter(filter: StatusFilter): void
}) {
  const queueIsClear = stats.attention + stats.active + stats.queued === 0
  if (queueIsClear)
    return (
      <section
        aria-label="Agent queue summary"
        className="mb-2 flex min-w-0 items-center gap-2 rounded-md border border-border/55 bg-card/62 px-2 py-1"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-400">
          <CheckCircle2 className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <strong className="shrink-0 text-xs">Queue clear</strong>
          <span className="hidden truncate text-[11px] text-muted-foreground sm:block">Nothing needs attention or is waiting to run.</span>
        </span>
        <button
          type="button"
          data-agent-summary="completed"
          aria-pressed={activeFilter === 'completed'}
          className={cn(
            'shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            activeFilter === 'completed' && 'bg-emerald-500/[.08] text-emerald-400',
          )}
          onClick={() => onFilter(activeFilter === 'completed' ? 'all' : 'completed')}
        >
          {stats.completed} past
        </button>
      </section>
    )

  return (
    <section aria-label="Agent queue summary" className="mb-2 overflow-hidden rounded-lg border border-border/55 bg-card/62">
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] divide-x divide-border/45">
        {summaryItems.map((item) => {
          const active = activeFilter === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              data-agent-summary={item.id}
              aria-pressed={active}
              className={cn(
                'group flex min-w-0 items-center gap-1.5 bg-transparent px-2 py-1.5 text-left transition-colors hover:bg-muted/30 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
                active && item.activeClass,
              )}
              onClick={() => onFilter(active ? 'all' : item.id)}
            >
              <span className={cn('hidden size-5 shrink-0 place-items-center rounded-md 2xl:grid', item.iconClass)}>
                <Icon className="size-3" />
              </span>
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <strong className="text-sm font-semibold tabular-nums">{item.value(stats)}</strong>
                  <span className="truncate text-[11px] font-medium">{item.label}</span>
                </span>
                <span className="sr-only">{item.detail(stats)}</span>
              </span>
            </button>
          )
        })}
        <button
          type="button"
          data-agent-summary="completed"
          aria-pressed={activeFilter === 'completed'}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/25 hover:text-foreground',
            activeFilter === 'completed' && 'bg-emerald-500/[.06] text-emerald-400',
          )}
          onClick={() => onFilter(activeFilter === 'completed' ? 'all' : 'completed')}
        >
          <span className="font-mono tabular-nums">{stats.completed}</span>
          <span>past</span>
        </button>
      </div>
    </section>
  )
}

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
  collapseHistory = false,
  historyCount,
  actions,
}: {
  threads: Job[]
  sort: ThreadSort
  variant: 'rail' | 'cards'
  selectedId?: number
  collapseHistory?: boolean
  historyCount?: number
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
        if (section.id === 'history' && collapseHistory) {
          return (
            <details key={section.id} className="group/history border-t border-border/40 first:border-t-0">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-2.5 text-xs text-muted-foreground hover:bg-muted/25 hover:text-foreground">
                <History className="size-3.5 shrink-0" />
                <span className="font-medium">Past sessions</span>
                <span className="ml-auto font-mono tabular-nums">{historyCount ?? section.threads.length}</span>
                <span className="w-8 text-right text-[10px] group-open/history:hidden">Show</span>
                <span className="hidden w-8 text-right text-[10px] group-open/history:inline">Hide</span>
              </summary>
              <div className={variant === 'rail' ? 'px-1.5 pb-2' : 'space-y-1.5 pt-1.5'}>{rows}</div>
            </details>
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

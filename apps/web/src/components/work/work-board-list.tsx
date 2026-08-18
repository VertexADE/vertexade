import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileSearch,
  GitBranch,
  GitPullRequest,
  Rocket,
  XCircle,
} from 'lucide-react'
import { AgentAvatar, agentDisplayName } from '@vertexade/ui/components/agent-identity'
import { BackendBadge } from '@vertexade/ui/components/backend-badge'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { useIsMobile } from '@vertexade/ui/hooks/use-mobile'
import { agentIsWorking, agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem, WorkState } from '@vertexade/ui/lib/dashboard-types'
import { displayBackendKey } from '@vertexade/ui/lib/backend-registry'
import { cn } from '@vertexade/ui/lib/utils'
import { workCardDetails } from '@vertexade/ui/lib/work-card'
import { workItemActivityAt } from '@vertexade/ui/lib/work-sort'
import { WorkCardMenu } from './work-card-menu'

export type WorkStatePresentation = {
  id: WorkState
  label: string
  description: string
  icon: typeof Clock3
  tone: string
}

const kindLabel: Record<WorkItem['kind'], string> = {
  implementation: 'Implementation',
  pr_review: 'PR review',
  investigation: 'Investigation',
  operational: 'Operational',
}

export function matchesWorkQuery(item: WorkItem, query: string) {
  if (!query) return true
  const haystack = `${item.key} ${displayBackendKey(item, item.key)} ${item.title} ${item.description} ${item.resources
    .map((resource) => resource.label)
    .join(' ')}`.toLowerCase()
  return haystack.includes(query.toLowerCase())
}

export function matchesWorkRepository(item: WorkItem, repository: string) {
  if (repository === 'all') return true
  const repositoryId = Number(repository)
  return item.primary_repository_id === repositoryId || item.resources.some((resource) => resource.repository_id === repositoryId)
}

export function matchesWorkKind(item: WorkItem, kind: string) {
  return kind === 'all' || item.kind === kind
}

export function matchesWorkAttention(item: WorkItem, attentionOnly: boolean) {
  return !attentionOnly || Boolean(item.attention)
}

export function WorkList({
  items,
  completed,
  selectedIds,
  onSelect,
}: {
  items: WorkItem[]
  completed: boolean
  selectedIds: ReadonlySet<number>
  onSelect(item: WorkItem, selected: boolean): void
}) {
  if (!items.length)
    return (
      <div className="grid min-h-72 place-items-center p-8 text-center">
        <div>
          <CheckCircle2 className="mx-auto size-7 text-muted-foreground" />
          <h2 className="mt-3 text-sm font-medium">{completed ? 'No completed Work' : 'No matching Work'}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {completed ? 'Delivered outcomes will remain easy to revisit here.' : 'Try changing the search or filters.'}
          </p>
        </div>
      </div>
    )
  return (
    <section className="overflow-hidden rounded-lg border border-border/75 bg-card/72 shadow-[0_1px_1px_rgba(0,0,0,.035)] backdrop-blur-sm">
      <header className="hidden grid-cols-[1.5rem_minmax(0,3fr)_minmax(18rem,1.35fr)_7rem] gap-4 border-b px-3 py-2 text-[11px] uppercase tracking-[.12em] text-muted-foreground lg:grid">
        <span />
        <span>Outcome</span>
        <span>Current signal</span>
        <span className="text-right">Activity</span>
      </header>
      {items.map((item) => (
        <WorkListRow key={item.id} item={item} selected={selectedIds.has(item.id)} onSelect={onSelect} />
      ))}
    </section>
  )
}

function WorkListRow({
  item,
  selected,
  onSelect,
}: {
  item: WorkItem
  selected: boolean
  onSelect(item: WorkItem, selected: boolean): void
}) {
  const details = workCardDetails(item)
  const style = signalStyle[details.signal.kind]
  const Icon = style.icon
  return (
    <div
      data-work-item-id={item.id}
      data-work-item-activity-at={workItemActivityAt(item)}
      data-selected={String(selected)}
      className="group grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2 border-b border-border/60 p-2.5 transition-colors last:border-b-0 hover:bg-accent/20 has-[[data-state=checked]]:bg-accent/25 sm:p-3 lg:items-center lg:gap-4 lg:px-3 lg:py-2.5"
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(value) => onSelect(item, Boolean(value))}
        aria-label={`Select ${displayBackendKey(item, item.key)}`}
      />
      <Link
        to="/work/$workKey"
        params={{ workKey: item.key }}
        className="grid min-w-0 gap-1.5 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,1.35fr)_7rem] lg:items-center lg:gap-4"
      >
        <WorkListOutcome item={item} pullRequestCount={details.pullRequests.length} />
        <div className="flex min-w-0 items-center gap-2 border-t border-border/60 pt-1.5 lg:border-l lg:border-t-0 lg:py-1 lg:pl-4">
          <Icon className={cn('size-3.5 shrink-0', style.tone)} />
          <span className="min-w-0">
            <strong className="block truncate text-xs">{details.signal.label}</strong>
            <small className="block truncate text-xs text-muted-foreground">{details.signal.detail}</small>
          </span>
        </div>
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>{age(workItemActivityAt(item))}</span>
          <ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" />
        </div>
      </Link>
    </div>
  )
}

function WorkListOutcome({ item, pullRequestCount }: { item: WorkItem; pullRequestCount: number }) {
  const emphasized = ['urgent', 'high'].includes(item.priority)
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-xs capitalize">
          {item.state}
        </Badge>
        {emphasized && (
          <Badge variant="secondary" className="text-xs capitalize">
            {item.priority}
          </Badge>
        )}
        <h2 className="min-w-0 flex-1 basis-full text-[15px] font-semibold leading-snug tracking-[-.01em] group-hover:text-primary group-hover:underline sm:basis-auto">
          <span className="line-clamp-2 lg:line-clamp-1">{item.title}</span>
        </h2>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
        <strong className="shrink-0 font-mono font-semibold text-blue-400">{displayBackendKey(item, item.key)}</strong>
        <BackendBadge source={item} nameOnly />
        <span aria-hidden="true">·</span>
        <span className="min-w-0 truncate">{item.repository_names.join(', ') || 'Workspace work'}</span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0">
          {item.threads.length} {item.threads.length === 1 ? 'thread' : 'threads'}
        </span>
        {pullRequestCount > 0 && <span className="shrink-0">· {pullRequestCount} PRs</span>}
      </div>
    </div>
  )
}

export function WorkColumn({
  state,
  items,
  hiddenOnMobile,
  movingIds,
  onMove,
  onArchive,
  onDelete,
}: {
  state: WorkStatePresentation
  items: WorkItem[]
  hiddenOnMobile: boolean
  movingIds: ReadonlySet<number>
  onMove(item: WorkItem, state: WorkState): void
  onArchive(item: WorkItem): void
  onDelete(item: WorkItem): void
}) {
  const Icon = state.icon
  const { isOver, setNodeRef } = useDroppable({ id: state.id })
  const content = items.length ? (
    items.map((item) => (
      <WorkCard key={item.id} item={item} moving={movingIds.has(item.id)} onMove={onMove} onArchive={onArchive} onDelete={onDelete} />
    ))
  ) : (
    <WorkColumnEmpty isOver={isOver} state={state} />
  )
  return (
    <section
      ref={setNodeRef}
      data-work-stage={state.id}
      data-drop-active={String(isOver)}
      className={cn('work-board-column min-w-0 overflow-hidden rounded-lg border border-border/45 bg-card/36 p-1.5 backdrop-blur-sm', {
        'is-mobile-hidden': hiddenOnMobile,
        'is-drop-target': isOver,
      })}
    >
      <header className="work-board-column-header mb-1 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 px-1.5 py-1.5">
        <Icon className={cn('size-3.5', state.tone)} />
        <span className="min-w-0">
          <h2 className="text-xs font-medium">{state.label}</h2>
          <small className="sr-only">{state.description}</small>
        </span>
        <span className="rounded-full bg-background/70 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
          {items.length}
        </span>
      </header>
      <div className="work-board-items space-y-1.5">{content}</div>
    </section>
  )
}

function WorkColumnEmpty({ isOver, state }: { isOver: boolean; state: WorkStatePresentation }) {
  return (
    <div className="work-board-empty px-3 py-7 text-center text-xs text-muted-foreground">
      {isOver ? `Move to ${state.label}` : 'Drop work here'}
    </div>
  )
}

function WorkCard({
  item,
  moving,
  onMove,
  onArchive,
  onDelete,
}: {
  item: WorkItem
  moving: boolean
  onMove(item: WorkItem, state: WorkState): void
  onArchive(item: WorkItem): void
  onDelete(item: WorkItem): void
}) {
  const details = workCardDetails(item)
  const isMobile = useIsMobile()
  const { isDragging, listeners, setNodeRef } = useDraggable({
    id: item.id,
    data: { state: item.state },
    disabled: moving || isMobile,
  })
  return (
    <article
      ref={setNodeRef}
      {...listeners}
      data-work-item-id={item.id}
      data-work-item-state={item.state}
      data-work-item-activity-at={workItemActivityAt(item)}
      data-dragging={String(isDragging)}
      aria-busy={moving}
      title={isMobile ? undefined : 'Drag to another stage'}
      className={cn(
        'work-board-card group overflow-hidden rounded-lg bg-card/82 transition-[background-color,border-color,box-shadow] hover:bg-card',
        {
          'is-review-ready bg-violet-500/[.045] ring-1 ring-violet-500/20': details.prInReview,
          'is-dragging': isDragging,
          'is-moving': moving,
        },
      )}
    >
      <WorkCardMenu item={item} busy={moving} onMove={onMove} onArchive={onArchive} onDelete={onDelete} />
      <WorkCardLink item={item} details={details} />
    </article>
  )
}

function WorkCardLink({ item, details }: { item: WorkItem; details: CardDetails }) {
  return (
    <Link
      to="/work/$workKey"
      params={{ workKey: item.key }}
      className="work-board-card-link block p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div>
        <WorkCardHeader item={item} />
        <WorkCardRepositories repositories={item.repository_names} />
        <WorkCardSignal details={details} />
        <WorkCardMeta item={item} pullRequestCount={details.pullRequests.length} />
      </div>
    </Link>
  )
}

function WorkCardMeta({ item, pullRequestCount }: { item: WorkItem; pullRequestCount: number }) {
  return (
    <div className="mt-1.5 flex items-center gap-2 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
      <WorkAgentStack item={item} />
      <span>
        {item.threads.length || 'No'} thread{item.threads.length === 1 ? '' : 's'}
      </span>
      {pullRequestCount > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span>
            {pullRequestCount} PR{pullRequestCount === 1 ? '' : 's'}
          </span>
        </>
      )}
      <ChevronRight className="ml-auto size-3 shrink-0 transition group-hover:translate-x-0.5" />
    </div>
  )
}

function WorkAgentStack({ item }: { item: WorkItem }) {
  const agents = Array.from(new Map(item.threads.map((job) => [job.agent_id, job])).values()).slice(0, 2)
  if (!agents.length)
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-full border border-dashed text-[11px] text-muted-foreground">
        <Bot className="size-2.5" />
      </span>
    )
  return (
    <span className="flex shrink-0 -space-x-1.5" aria-label={agents.map((job) => agentDisplayName(job.agent_id)).join(', ')}>
      {agents.map((job) => {
        const state = agentThreadState(job)
        return (
          <span key={job.agent_id} className="relative rounded-full ring-2 ring-card">
            <AgentAvatar id={job.agent_id} name={agentDisplayName(job.agent_id)} size="xs" />
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-card',
                agentIsWorking(state)
                  ? 'bg-blue-400'
                  : state === 'failed'
                    ? 'bg-red-400'
                    : state === 'waiting'
                      ? 'bg-amber-400'
                      : 'bg-emerald-400',
              )}
            />
          </span>
        )
      })}
    </span>
  )
}

function WorkCardRepositories({ repositories }: { repositories: string[] }) {
  if (!repositories.length)
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <GitBranch className="size-2.5 shrink-0" />
        No repository connected
      </p>
    )
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground" aria-label={`Connected repositories: ${repositories.join(', ')}`}>
      {repositories.map((repository) => (
        <li key={repository} className="flex min-w-0 items-center gap-1" title={repository}>
          <GitBranch className="size-2.5 shrink-0" />
          <span className="truncate">{repository}</span>
        </li>
      ))}
    </ul>
  )
}

type CardDetails = ReturnType<typeof workCardDetails>

function WorkCardHeader({ item }: { item: WorkItem }) {
  return (
    <div className="pr-7">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-blue-400">{displayBackendKey(item, item.key)}</span>
          <BackendBadge source={item} nameOnly />
          <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
            ·
          </span>
          <span className="hidden truncate text-muted-foreground sm:inline">{kindLabel[item.kind]}</span>
        </span>
        <span className="shrink-0 text-muted-foreground">{age(workItemActivityAt(item))}</span>
      </div>
      <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug tracking-[-.01em]">{item.title}</h3>
      {['high', 'urgent'].includes(item.priority) && (
        <span className="mt-1 inline-block text-[10px] font-medium uppercase text-warning">{item.priority} priority</span>
      )}
    </div>
  )
}

const signalStyle = {
  attention: { icon: AlertTriangle, tone: 'text-amber-300' },
  failed: { icon: XCircle, tone: 'text-red-300' },
  active: { icon: Bot, tone: 'text-info' },
  review: { icon: GitPullRequest, tone: 'text-violet-300' },
  output: { icon: FileSearch, tone: 'text-emerald-300' },
  deploy: { icon: Rocket, tone: 'text-amber-300' },
  done: { icon: CheckCircle2, tone: 'text-emerald-300' },
  idle: { icon: Clock3, tone: 'text-muted-foreground' },
} as const

function WorkCardSignal({ details }: { details: CardDetails }) {
  const style = signalStyle[details.signal.kind]
  const Icon = style.icon
  return (
    <div className={cn('mt-1.5 flex items-center gap-2', style.tone)}>
      <Icon className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{details.signal.label}</span>
      <span className="hidden max-w-[45%] shrink-0 truncate text-[11px] opacity-60 xl:block">{details.signal.detail}</span>
    </div>
  )
}

import { Link } from '@tanstack/react-router'
import { Archive, ArrowRight, Bot, Check, CircleAlert, Clock3, MessageSquareText, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { BackendBadge } from '@vertexade/ui/components/backend-badge'
import { agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { displayBackendKey } from '@vertexade/ui/lib/backend-registry'
import { cn } from '@vertexade/ui/lib/utils'
import { focusItemDisplay, focusItemPullRequest } from './focus-item-presentation'
import { attentionRetryLabel, workAttentionPresentation } from '../work/work-attention-presentation'
import type { WorkAttentionPresentation } from '../work/work-attention-presentation'

export function FocusDecisionCard({
  item,
  desktopRow = false,
  className,
  onDelegate,
  onArchive,
  onDelete,
  onDismiss,
  onPriority,
  onResolve,
  onSnooze,
}: {
  item: WorkItem
  desktopRow?: boolean
  className?: string
  onDelegate?: (item: WorkItem) => void
  onArchive: (item: WorkItem) => void
  onDelete: (item: WorkItem) => void
  onDismiss: (item: WorkItem) => void
  onPriority: (item: WorkItem, priority: WorkItem['priority']) => void
  onResolve: (item: WorkItem) => void
  onSnooze: (item: WorkItem, until: string) => void
}) {
  const display = focusItemDisplay(item)
  const attention = workAttentionPresentation(item)

  return (
    <article className={focusDecisionCardClass(desktopRow, className)}>
      <div className="min-w-0">
        <FocusDecisionMetadata item={item} reference={display.reference} repository={display.repository} />
        <h3 className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug">{display.title}</h3>
        <p className="mt-1.5 flex min-w-0 items-start gap-1.5 text-xs leading-relaxed text-warning">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="line-clamp-2" title={attention?.summary}>
            {attention?.summary}
          </span>
        </p>
        <FocusDecisionTechnicalDetails details={attention?.technicalDetails} />
      </div>
      <div className={cn('mt-2 flex items-center gap-1.5 self-start sm:mt-auto', desktopRow && 'lg:mt-0')}>
        <FocusDecisionAction item={item} desktopRow={desktopRow} onDelegate={onDelegate} />
        <Button variant="outline" size="sm" onClick={() => onResolve(item)}>
          <Check /> Resolve
        </Button>
        <DecisionMenu
          item={item}
          onArchive={onArchive}
          onDelete={onDelete}
          onDismiss={onDismiss}
          onPriority={onPriority}
          onSnooze={onSnooze}
        />
      </div>
    </article>
  )
}

const priorities: WorkItem['priority'][] = ['urgent', 'high', 'normal', 'low']

function snoozeUntil(period: 'hour' | 'tomorrow' | 'week') {
  const date = new Date()
  if (period === 'hour') date.setHours(date.getHours() + 1)
  if (period === 'tomorrow') {
    date.setDate(date.getDate() + 1)
    date.setHours(9, 0, 0, 0)
  }
  if (period === 'week') date.setDate(date.getDate() + 7)
  return date.toISOString()
}

function DecisionMenu({
  item,
  onArchive,
  onDelete,
  onDismiss,
  onPriority,
  onSnooze,
}: {
  item: WorkItem
  onArchive(item: WorkItem): void
  onDelete(item: WorkItem): void
  onDismiss(item: WorkItem): void
  onPriority(item: WorkItem, priority: WorkItem['priority']): void
  onSnooze(item: WorkItem, until: string): void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More decision actions for ${item.key}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Decision options</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Clock3 /> Snooze
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => onSnooze(item, snoozeUntil('hour'))}>One hour</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSnooze(item, snoozeUntil('tomorrow'))}>Until tomorrow</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSnooze(item, snoozeUntil('week'))}>One week</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Change priority</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {priorities.map((priority) => (
              <DropdownMenuItem
                key={priority}
                disabled={item.priority === priority}
                onSelect={() => onPriority(item, priority)}
                className="capitalize"
              >
                {item.priority === priority ? <Check /> : <span className="size-4" />}
                {priority}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => onDismiss(item)}>
          <Check /> Dismiss decision
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onArchive(item)}>
          <Archive /> Archive Work
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(item)}>
          <Trash2 /> Delete Work permanently
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FocusDecisionTechnicalDetails({ details }: { details?: string | null }) {
  if (!details) return null
  return (
    <details className="mt-1.5 text-[11px] text-muted-foreground">
      <summary className="w-fit cursor-pointer hover:text-foreground">Technical details</summary>
      <p className="mt-1 line-clamp-3 whitespace-pre-wrap font-mono text-[10px] leading-relaxed">{details}</p>
    </details>
  )
}

function FocusDecisionMetadata({ item, reference, repository }: { item: WorkItem; reference: string | null; repository: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="font-mono text-primary">{displayBackendKey(item, item.key)}</span>
      <BackendBadge source={item} />
      <span aria-hidden="true">·</span>
      <span className="truncate">{reference}</span>
      {repository && (
        <>
          <span aria-hidden="true">·</span>
          <span className="truncate">{repository}</span>
        </>
      )}
    </div>
  )
}

function FocusDecisionAction({
  item,
  desktopRow,
  onDelegate,
}: {
  item: WorkItem
  desktopRow: boolean
  onDelegate?: (item: WorkItem) => void
}) {
  const attention = workAttentionPresentation(item)
  const className = cn('w-fit self-start', desktopRow && 'lg:min-w-32')
  return (
    [
      inputDecisionAction(item, attention, className),
      failedDecisionAction(item, attention, className),
      retryDecisionAction(item, attention, onDelegate, className),
      destinationDecisionAction(item, className),
    ].find(Boolean) || null
  )
}

function inputDecisionAction(item: WorkItem, attention: WorkAttentionPresentation | null, className: string) {
  if (attention?.kind !== 'input') return null
  const job = item.threads.find((candidate) => agentThreadState(candidate) === 'waiting')
  if (!job) return null
  return (
    <Button asChild size="sm" className={className}>
      <Link to="/threads/$threadId" params={{ threadId: String(job.id) }}>
        <MessageSquareText />
        Answer agent
      </Link>
    </Button>
  )
}

function failedDecisionAction(item: WorkItem, attention: WorkAttentionPresentation | null, className: string) {
  if (attention?.kind !== 'run_failed') return null
  const job = item.threads.find((candidate) => candidate.status === 'failed')
  if (!job) return null
  return (
    <Button asChild size="sm" className={className}>
      <Link to="/threads/$threadId" params={{ threadId: String(job.id) }}>
        <Bot />
        Inspect run
      </Link>
    </Button>
  )
}

function retryDecisionAction(
  item: WorkItem,
  attention: WorkAttentionPresentation | null,
  onDelegate: ((item: WorkItem) => void) | undefined,
  className: string,
) {
  const label = attention ? attentionRetryLabel(item, attention.kind) : null
  if (!label || !onDelegate) return null
  return (
    <Button type="button" size="sm" className={className} onClick={() => onDelegate(item)}>
      <RotateCcw />
      {label}
    </Button>
  )
}

function destinationDecisionAction(item: WorkItem, className: string) {
  const pullRequest = focusItemPullRequest(item)
  if (!pullRequest) {
    return (
      <Button asChild size="sm" className={className}>
        <Link to="/work/$workKey" params={{ workKey: item.key }}>
          Open work
          <ArrowRight />
        </Link>
      </Button>
    )
  }
  return (
    <Button asChild size="sm" className={className}>
      <Link
        to="/pull-requests/$repoId/$prNumber"
        params={{ repoId: String(pullRequest.repositoryId), prNumber: String(pullRequest.number) }}
      >
        Review update
        <ArrowRight />
      </Link>
    </Button>
  )
}

function focusDecisionCardClass(desktopRow: boolean, className?: string) {
  return cn(
    'flex min-w-0 flex-col bg-background p-2.5 transition-colors hover:bg-muted sm:p-3',
    desktopRow && 'lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-4 lg:px-4 lg:py-2.5',
    className,
  )
}

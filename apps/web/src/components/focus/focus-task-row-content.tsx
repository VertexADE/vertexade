import { Link } from '@tanstack/react-router'
import { Bot, Check, ChevronDown, Play } from 'lucide-react'
import { AgentAvatar, agentDisplayName } from '@vertexade/ui/components/agent-identity'
import { BackendBadge } from '@vertexade/ui/components/backend-badge'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { displayBackendKey } from '@vertexade/ui/lib/backend-registry'
import { workItemActivityAt } from '@vertexade/ui/lib/work-sort'
import { cn } from '@vertexade/ui/lib/utils'
import { workCompletionBlocker } from '../../lib/work-completion'
import { focusItemActiveJob, focusItemDisplay, focusPriorityLabel, focusPriorityTone, focusStateLabel } from './focus-item-presentation'
import type { AcceptanceCheck } from './focus-task-model'

type FocusTaskRowContentProps = {
  item: WorkItem
  checks: AcceptanceCheck[]
  completing: boolean
  expanded: boolean
  onComplete: () => void
  onDelegate: () => void
  onExpand: () => void
}

export function FocusTaskRowContent(props: FocusTaskRowContentProps) {
  const activeJob = focusItemActiveJob(props.item)
  return (
    <>
      <div className="min-w-0 flex-1 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(13rem,1.35fr)_5rem_7.5rem] lg:items-center lg:gap-4">
        <FocusTaskIdentity item={props.item} checks={props.checks} activeJob={activeJob} />
        <FocusTaskContext item={props.item} />
        <FocusTaskUpdated item={props.item} />
        <FocusTaskActions item={props.item} activeJob={activeJob} onDelegate={props.onDelegate} />
      </div>
      <FocusTaskControls
        item={props.item}
        completing={props.completing}
        expanded={props.expanded}
        onComplete={props.onComplete}
        onExpand={props.onExpand}
      />
    </>
  )
}

function FocusTaskIdentity({
  item,
  checks,
  activeJob,
}: {
  item: WorkItem
  checks: AcceptanceCheck[]
  activeJob: WorkItem['threads'][number] | null
}) {
  const display = focusItemDisplay(item)
  return (
    <div className="min-w-0">
      <Link
        to="/work/$workKey"
        params={{ workKey: item.key }}
        className="block text-[15px] font-semibold leading-snug tracking-[-.01em] hover:text-primary hover:underline"
      >
        <span className="line-clamp-2 lg:line-clamp-1">{display.title}</span>
      </Link>
      <FocusTaskMetadata item={item} reference={display.reference} repository={display.repository} />
      <FocusTaskSignals item={item} checks={checks} activeJob={activeJob} />
    </div>
  )
}

function FocusTaskMetadata({ item, reference, repository }: { item: WorkItem; reference: string | null; repository: string | null }) {
  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
      <strong className="shrink-0 font-mono font-semibold text-blue-400">{displayBackendKey(item, item.key)}</strong>
      <BackendBadge source={item} />
      <span aria-hidden="true">·</span>
      <span className="shrink-0">{focusStateLabel[item.state]}</span>
      <span className="contents lg:hidden">
        {reference && (
          <>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{reference}</span>
          </>
        )}
        {repository && (
          <>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate">{repository}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span className="shrink-0">updated {age(workItemActivityAt(item))}</span>
      </span>
    </div>
  )
}

function FocusTaskContext({ item }: { item: WorkItem }) {
  const display = focusItemDisplay(item)
  const values = [display.reference, display.repository].filter(Boolean)
  return (
    <div className="hidden min-w-0 border-l border-border/65 pl-4 lg:block">
      <span className="block text-[10px] font-medium uppercase tracking-[.12em] text-muted-foreground">Context</span>
      <p className="mt-1 truncate text-xs text-foreground/80">{values.join(' · ') || 'Workspace work'}</p>
    </div>
  )
}

function FocusTaskUpdated({ item }: { item: WorkItem }) {
  return <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">{age(workItemActivityAt(item))}</span>
}

function FocusTaskSignals({
  item,
  checks,
  activeJob,
}: {
  item: WorkItem
  checks: AcceptanceCheck[]
  activeJob: WorkItem['threads'][number] | null
}) {
  if (!hasFocusTaskSignals(item, checks, activeJob)) return null
  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
      <FocusPrioritySignal priority={item.priority} />
      <FocusCriteriaSignal checks={checks} />
      <FocusAgentSignal activeJob={activeJob} />
    </div>
  )
}

function FocusPrioritySignal({ priority }: { priority: WorkItem['priority'] }) {
  if (priority === 'normal') return null
  return (
    <Badge variant="outline" className={cn('h-5 px-1.5 text-[11px] uppercase', focusPriorityTone[priority])}>
      {focusPriorityLabel[priority]}
    </Badge>
  )
}

function FocusCriteriaSignal({ checks }: { checks: AcceptanceCheck[] }) {
  if (!checks.length) return null
  const completedChecks = checks.filter((check) => check.complete).length
  return (
    <span className="text-[11px] text-muted-foreground">
      {completedChecks}/{checks.length} criteria
    </span>
  )
}

function FocusAgentSignal({ activeJob }: { activeJob: WorkItem['threads'][number] | null }) {
  if (!activeJob) return null
  const name = agentDisplayName(activeJob.agent_id)
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-emerald-300">
      <AgentAvatar id={activeJob.agent_id} name={name} size="xs" />
      <span className="max-w-32 truncate">{name} working</span>
    </span>
  )
}

function hasFocusTaskSignals(item: WorkItem, checks: AcceptanceCheck[], activeJob: WorkItem['threads'][number] | null) {
  return item.priority !== 'normal' || checks.length > 0 || Boolean(activeJob)
}

function FocusTaskActions({
  item,
  activeJob,
  onDelegate,
}: {
  item: WorkItem
  activeJob: WorkItem['threads'][number] | null
  onDelegate: () => void
}) {
  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 lg:mt-0 lg:flex-nowrap lg:justify-end">
      {activeJob ? (
        <Button asChild size="xs">
          <Link to="/threads/$threadId" params={{ threadId: String(activeJob.id) }}>
            <Bot />
            Open agent
          </Link>
        </Button>
      ) : (
        <Button type="button" size="xs" variant="outline" onClick={onDelegate}>
          <Play />
          Start agent
        </Button>
      )}
    </div>
  )
}

function FocusTaskControls({
  item,
  completing,
  expanded,
  onComplete,
  onExpand,
}: {
  item: WorkItem
  completing: boolean
  expanded: boolean
  onComplete: () => void
  onExpand: () => void
}) {
  const completionBlocker = workCompletionBlocker(item)
  const displayKey = displayBackendKey(item, item.key)
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 lg:flex-row">
      {!completionBlocker && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={completing}
          onClick={onComplete}
          aria-label={`Mark ${displayKey} complete`}
          title={`Mark ${displayKey} complete`}
        >
          <Check />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onExpand}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${displayKey}`}
      >
        <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
      </Button>
    </div>
  )
}

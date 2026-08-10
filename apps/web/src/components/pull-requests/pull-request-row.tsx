import { AlertTriangle, GitMerge, RefreshCw } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@vertexade/ui/components/ui/avatar'
import { BackendBadge } from '@vertexade/ui/components/backend-badge'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { DashboardData, GithubReviewer, Job, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import type { PullRequestFlowDecision } from '@vertexade/ui/lib/pull-request-flow'
import { cn } from '@vertexade/ui/lib/utils'
import { pullRequestQueueGroup } from '../../lib/pull-request-action-policy'

import { PrAssignedPeople } from './pull-request-assignees'
import { AgentReviewStatus, PrSignal } from './pull-request-row-status'
import { usePrRow } from './use-pr-row'
import { PullRequestThreadLocations } from './pull-request-thread-locations'

const typeStyles: Record<string, string> = {
  feat: 'border-blue-500/40 text-blue-400',
  fix: 'border-red-500/40 text-red-400',
  perf: 'border-amber-500/40 text-amber-400',
  refactor: 'border-violet-500/40 text-violet-400',
  test: 'border-emerald-500/40 text-emerald-400',
  docs: 'border-cyan-500/40 text-cyan-400',
  ci: 'border-orange-500/40 text-orange-400',
}
const queueAccent = {
  action: 'before:bg-red-400/70',
  review: 'before:bg-amber-400/70',
  ship: 'before:bg-emerald-400/70',
  waiting: 'before:bg-blue-400/70',
}
import { PrQuickActions } from './pull-request-row-actions'
export function PrRow({
  pr,
  agentThreads,
  currentUser,
  scm,
  serviceColor,
  onDetails,
  onLaunch,
  onFork,
  onLabels,
  onReviewers,
  onReview,
  onRun,
  onReconcile,
  selected,
  onSelectedChange,
}: {
  pr: PullRequest
  agentThreads: Job[]
  currentUser: GithubReviewer | null
  scm: DashboardData['presentation']['scm']
  serviceColor?: string
  onDetails: () => void
  onLaunch: (flow: PullRequestFlowDecision) => void
  onFork: () => void
  onLabels: () => void
  onReviewers: () => void
  onReview: () => void
  onRun: (id: number) => void
  onReconcile: () => Promise<void>
  selected: boolean
  onSelectedChange(selected: boolean): void
}) {
  const {
    labels,
    reviewers,
    conventional,
    openLongerThanDay,
    assignedToMe,
    authoredByMe,
    checksSignal,
    mergeSignal,
    readinessBusy,
    addingToWork,
    assigningMe,
    mutationFailure,
    retryMutation,
    handlers,
    recommendation,
    addToWork,
    assignMe,
    changeReadiness,
  } = usePrRow({
    pr,
    currentUser,
    agentThreads,
    onDetails,
    onLaunch,
    onReview,
    onReconcile,
  })
  const queueGroup = pullRequestQueueGroup(pr, {
    identity: currentUser ? { status: 'ready', login: currentUser.login } : { status: 'loading' },
    threads: agentThreads,
  })
  const lifecycleStatus = pr.draft ? 'Draft' : pr.merge_state_status === 'CLOSED' ? 'Closed' : 'Open'
  return (
    <article
      id={`pr-card-${pr.repo_id}-${pr.number}`}
      tabIndex={-1}
      data-pr-card
      className={cn(
        'relative min-w-0 overflow-hidden rounded-lg border border-border/75 bg-card/75 transition-colors before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full hover:border-foreground/15 hover:bg-card sm:rounded-md lg:rounded-none lg:border-x-0 lg:border-t-0 lg:bg-transparent',
        queueAccent[queueGroup],
        selected && 'border-blue-500/40 ring-1 ring-blue-500/20',
      )}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(7.5rem,.72fr)] gap-x-2 gap-y-1 p-2 sm:gap-1.5 sm:p-3 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,1.35fr)_11rem] lg:items-center lg:gap-4 lg:px-3 lg:py-2.5">
        <header className="col-span-2 min-w-0 space-y-1 sm:space-y-1.5 lg:col-span-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap">
            <Checkbox
              checked={selected}
              onCheckedChange={(checked) => onSelectedChange(Boolean(checked))}
              aria-label={`Select ${pr.full_name} pull request ${pr.number}`}
              className="mr-0.5 size-3.5"
            />
            <Badge
              variant="outline"
              className={cn(
                'h-5 shrink-0 rounded-full px-1.5 text-[11px]',
                lifecycleStatus === 'Open' && 'border-emerald-500/40 text-emerald-400',
                lifecycleStatus === 'Closed' && 'border-red-500/40 text-red-400',
                lifecycleStatus === 'Draft' && 'border-slate-500/40',
              )}
            >
              {lifecycleStatus}
            </Badge>
            {conventional && (
              <Badge variant="outline" className={cn('h-5 shrink-0 px-1.5 font-mono text-[11px] uppercase', typeStyles[conventional.type])}>
                {conventional.type}
              </Badge>
            )}
            {conventional?.scope && (
              <Badge
                variant="outline"
                className="h-5 max-w-28 shrink-0 truncate px-1.5 font-mono text-[11px]"
                style={
                  serviceColor
                    ? {
                        color: serviceColor,
                        borderColor: `${serviceColor}80`,
                        backgroundColor: `${serviceColor}18`,
                      }
                    : undefined
                }
              >
                {conventional.scope}
              </Badge>
            )}
            <h2 className="min-w-0 flex-1 basis-full pt-0.5 text-[15px] font-semibold leading-snug tracking-[-.01em] sm:basis-auto sm:pt-0 sm:text-[15px]">
              <a
                href={`/pull-requests/${pr.repo_id}/${pr.number}`}
                onClick={(event) => {
                  event.preventDefault()
                  onDetails()
                }}
                className="line-clamp-2 block text-foreground transition-colors hover:text-blue-400 hover:underline lg:line-clamp-1"
              >
                {conventional?.subject || pr.title}
              </a>
            </h2>
            {openLongerThanDay && !pr.draft && (
              <Badge variant="outline" className="hidden h-5 shrink-0 border-amber-500/40 px-1.5 text-[11px] text-amber-400 sm:inline-flex">
                {age(pr.created_at).replace(' ago', '')}
              </Badge>
            )}
            {conventional?.breaking && (
              <Badge variant="destructive" className="hidden h-5 shrink-0 px-1.5 text-[11px] sm:inline-flex">
                Breaking
              </Badge>
            )}
            {labels.length > 0 && (
              <span className="ml-auto hidden min-w-0 items-center gap-1 xl:flex" aria-label="Platform labels">
                {labels.slice(0, 2).map((label) => (
                  <Badge key={label.name} variant="outline" className="h-5 max-w-28 shrink-0 truncate px-1.5 font-mono text-[11px]">
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: /^([0-9a-f]{6})$/i.test(label.color) ? `#${label.color}` : '#6b7280',
                      }}
                    />
                    {label.name}
                  </Badge>
                ))}
                {labels.length > 2 && <span className="shrink-0 text-[11px] text-muted-foreground">+{labels.length - 2}</span>}
              </span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-muted-foreground">
            <strong className="min-w-0 max-w-full truncate font-semibold text-blue-400" title={pr.full_name}>
              <span className="sm:hidden">{pr.full_name.split('/').at(-1)}</span>
              <span className="hidden sm:inline">{pr.full_name}</span>
            </strong>
            <span className="shrink-0 font-mono">#{pr.number}</span>
            <BackendBadge source={pr} />
            <span aria-hidden="true">·</span>
            <span className="shrink-0">updated {age(pr.updated_at)}</span>
            <span aria-hidden="true" className="hidden sm:inline">
              ·
            </span>
            <span className="hidden min-w-0 truncate font-mono sm:inline" title={`${pr.head_ref} → ${pr.base_ref}`}>
              <span className="text-blue-400">{pr.head_ref}</span> → {pr.base_ref}
            </span>
          </div>
          <div className="hidden min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground sm:flex">
            <span className="flex min-w-0 shrink-0 items-center gap-1.5">
              <Avatar size="sm" className="size-5">
                <AvatarImage src={pr.author_avatar_url || undefined} alt="" />
                <AvatarFallback>
                  {String(pr.author || '?')
                    .slice(0, 1)
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="max-w-28 truncate text-foreground/80">{pr.author || 'Unknown author'}</span>
            </span>
          </div>
          <PullRequestThreadLocations threads={agentThreads} onRun={onRun} />
          {(Boolean(pr.auto_merge_enabled) || Boolean(pr.manual_not_ready_at) || Boolean(pr.updated_after_not_ready_at)) && (
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 lg:col-span-2">
              {pr.auto_merge_enabled ? (
                <Badge variant="outline" className="h-5 shrink-0 border-emerald-500/40 px-1.5 text-[11px] text-emerald-400">
                  <GitMerge />
                  Auto-merge
                </Badge>
              ) : null}
              {pr.manual_not_ready_at && (
                <Badge variant="outline" className="h-5 shrink-0 border-red-500/40 px-1.5 text-[11px] text-red-400">
                  Not ready · {age(pr.manual_not_ready_at)}
                </Badge>
              )}
              {pr.updated_after_not_ready_at && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={readinessBusy}
                  className="h-5 min-w-0 border-blue-500/40 px-1.5 text-[11px] text-blue-400"
                  onClick={() => changeReadiness('dismiss-update')}
                >
                  <RefreshCw />
                  <span className="truncate">Updated since not ready</span>
                </Button>
              )}
            </div>
          )}
        </header>

        <div className="min-w-0 border-t border-border/65 pt-1 lg:border-t-0 lg:border-l lg:py-1 lg:pl-4">
          <div className="mb-1 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 lg:mb-1.5">
            <PrSignal label="Checks" value={checksSignal.label} className={checksSignal.className} />
            <PrSignal label="Merge" value={mergeSignal.label} className={mergeSignal.className} />
          </div>
          <div className="hidden min-w-0 sm:block lg:min-h-5">{reviewers.length > 0 && <PrAssignedPeople reviewers={reviewers} />}</div>
          <div className={cn('hidden min-w-0 sm:block', reviewers.length > 0 && 'mt-1')}>
            <AgentReviewStatus pr={pr} onRun={onRun} onChanged={onReconcile} />
          </div>
        </div>

        <div className="min-w-0">
          <PrQuickActions
            pr={pr}
            handlers={handlers}
            scm={scm}
            recommendation={recommendation}
            authoredByMe={authoredByMe}
            assignedToMe={assignedToMe}
            addingToWork={addingToWork}
            assigningMe={assigningMe}
            readinessBusy={readinessBusy}
            onAddToWork={() => void addToWork()}
            onFork={onFork}
            onLabels={onLabels}
            onReviewers={onReviewers}
            onAssignMe={() => void assignMe()}
            onReadiness={() => void changeReadiness(pr.manual_not_ready_at ? 'clear' : 'mark')}
          />
        </div>
      </div>
      {mutationFailure ? (
        <div
          role="alert"
          className="flex min-w-0 items-center gap-2 border-t border-red-500/25 bg-red-500/8 px-3.5 py-2 text-xs text-red-300 sm:px-4"
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{mutationFailure.message}</span>
          <Button variant="ghost" size="xs" className="shrink-0 text-red-200" onClick={() => void retryMutation(mutationFailure.key)}>
            <RefreshCw />
            Retry
          </Button>
        </div>
      ) : null}
    </article>
  )
}

import { useState, type ReactNode } from 'react'
import { Bot, ChevronDown, CircleDot, FileSearch, GitBranch, GitPullRequest, MoreHorizontal, Play } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import { AgentReviewStatusControls } from '@vertexade/ui/components/agent-review-status'
import { EntityHeader, EntityInspectorSection, EntityWorkspace } from '@vertexade/ui/components/entity-workspace'
import { MarkdownContent } from '@vertexade/ui/components/markdown-content'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { DialogDescription, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@vertexade/ui/components/ui/dropdown-menu'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { PullRequestDialogItem } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { pullRequestNextDecision, type CheckResult, type PrDetailsActions, type PullRequestDetails } from './pr-details-model'

function AgentReviewLink({ reviewId, onOpenRun }: { reviewId?: number | null; onOpenRun?: (jobId: number) => void }) {
  if (!reviewId) return <p className="mt-2 text-muted-foreground">No completed agent review</p>
  if (onOpenRun)
    return (
      <button type="button" onClick={() => onOpenRun(reviewId)} className="mt-2 block font-medium text-blue-400 hover:underline">
        Open review #{reviewId}
      </button>
    )
  return (
    <Link to="/threads" search={{ thread: reviewId }} className="mt-2 block font-medium text-blue-400 hover:underline">
      Open review #{reviewId}
    </Link>
  )
}

function AgentReviewCard({ pr, onOpenRun }: { pr: PullRequestDialogItem; onOpenRun?: (jobId: number) => void }) {
  return (
    <div className="p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <strong className="flex items-center gap-1.5">
          <Bot className="size-3.5 text-blue-400" />
          Agent review
        </strong>
        <AgentReviewStatusControls
          currentHeadSha={pr.head_sha}
          reviewedHeadSha={pr.latest_agent_review_head_sha}
          reviewId={pr.latest_agent_review_id}
        />
      </div>
      <AgentReviewLink reviewId={pr.latest_agent_review_id} onOpenRun={onOpenRun} />
      <div className="mt-1">
        <AgentReviewStatusControls
          currentHeadSha={pr.head_sha}
          watching={pr.auto_review_watch === undefined ? undefined : Boolean(pr.auto_review_watch)}
        />
      </div>
    </div>
  )
}

function checkStatus(check: CheckResult) {
  return String(check.conclusion || check.state || check.status || 'UNKNOWN').toUpperCase()
}

function checkSummary(checks: CheckResult[]) {
  const failed = checks.filter((check) => ['FAILURE', 'FAILED', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(checkStatus(check))).length
  const pending = checks.filter((check) => ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED'].includes(checkStatus(check))).length
  if (failed) return { label: `${failed} failing`, className: 'border-red-500/40 text-red-400', dot: 'bg-red-400' }
  if (pending) return { label: `${pending} pending`, className: 'border-amber-500/40 text-amber-400', dot: 'bg-amber-400' }
  if (checks.length) return { label: 'All checks passed', className: 'border-emerald-500/40 text-emerald-400', dot: 'bg-emerald-400' }
  return { label: 'No checks', className: 'text-muted-foreground', dot: 'bg-slate-400' }
}

function reviewSummary(decision: string) {
  if (decision === 'APPROVED') return { label: 'Approved', className: 'border-emerald-500/40 text-emerald-400', dot: 'bg-emerald-400' }
  if (decision === 'CHANGES_REQUESTED')
    return { label: 'Changes requested', className: 'border-red-500/40 text-red-400', dot: 'bg-red-400' }
  return {
    label: decision ? decision.replaceAll('_', ' ').toLowerCase() : 'Review required',
    className: 'border-amber-500/40 text-amber-400',
    dot: 'bg-amber-400',
  }
}

function mergeSummary(details: PullRequestDetails) {
  if (['CONFLICTING', 'DIRTY'].includes(details.mergeable))
    return { label: 'Conflicts', className: 'border-red-500/40 text-red-400', dot: 'bg-red-400' }
  if (details.mergeStateStatus === 'BEHIND')
    return { label: 'Branch behind', className: 'border-amber-500/40 text-amber-400', dot: 'bg-amber-400' }
  if (details.mergeable === 'MERGEABLE')
    return { label: 'Mergeable', className: 'border-emerald-500/40 text-emerald-400', dot: 'bg-emerald-400' }
  return { label: details.mergeStateStatus.toLowerCase(), className: 'text-muted-foreground', dot: 'bg-slate-400' }
}

function DetailSignal({ label, value, className, dot }: { label: string; value: string; className: string; dot: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-medium uppercase tracking-[.12em] text-muted-foreground">{label}</span>
      <span className={cn('mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold', className)}>
        <span className={cn('size-1.5 shrink-0 rounded-full', dot)} />
        <span className="truncate">{value}</span>
      </span>
    </div>
  )
}

function DetailActions({ actions, mobileDock = false }: { actions?: PrDetailsActions; mobileDock?: boolean }) {
  if (!actions) return null
  const hasHumanReviewActions = Boolean(actions.contextualReviewActions)
  return (
    <div className="flex min-w-0 flex-wrap gap-2 lg:items-start lg:justify-end">
      {hasHumanReviewActions && (
        <div data-pr-review-dock={mobileDock || undefined} className={cn('flex min-w-0 flex-wrap gap-2', mobileDock && 'w-full md:w-auto')}>
          {actions.contextualReviewActions}
        </div>
      )}
      <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 sm:flex sm:w-auto sm:flex-wrap">
        <Button
          data-audit-action="pull-request.agent.work"
          size="sm"
          variant={hasHumanReviewActions ? 'outline' : 'default'}
          className="min-w-0 justify-center"
          onClick={actions.onStartWork}
          disabled={!actions.onStartWork}
        >
          <Play />
          <span className="sm:hidden">Fix</span>
          <span className="hidden sm:inline">Fix with agent</span>
        </Button>
        <Button
          data-audit-action="pull-request.agent.review"
          size="sm"
          variant="outline"
          className="min-w-0 justify-center"
          onClick={actions.onStartReview}
          disabled={!actions.onStartReview}
        >
          <FileSearch />
          <span className="sm:hidden">Review</span>
          <span className="hidden sm:inline">Review with agent</span>
        </Button>
        {actions.contextualMenuActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="outline" aria-label="More pull request actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {actions.contextualMenuActions}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

export function PullRequestHeader({
  pr,
  details,
  providerName,
  headerActions,
  backAction,
  embedded,
}: {
  pr: PullRequestDialogItem
  details: PullRequestDetails | null
  providerName: string
  headerActions: ReactNode
  backAction?: ReactNode
  embedded: boolean
}) {
  const relatedMenu = <PullRequestRelatedMenu pr={pr} />
  if (!embedded)
    return (
      <DialogHeader className="mx-0 mt-0 shrink-0 border-b px-4 py-3 pr-12">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <DialogTitle className="text-base sm:text-lg">{pr.title}</DialogTitle>
            <DialogDescription className="mt-1 break-words text-xs">
              {pr.full_name} #{pr.number}
              {details ? ` · ${details.author.login} · opened ${age(details.createdAt)}` : ''}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1">
            {relatedMenu}
            {headerActions}
          </div>
        </div>
      </DialogHeader>
    )

  return (
    <div className="px-3 pt-3 sm:px-5 sm:pt-4">
      <EntityHeader
        className="-mx-3 mb-0 rounded-none border-x-0 [&_[data-slot=entity-metadata]]:border-t-0 [&_[data-slot=entity-metadata]]:bg-transparent [&_[data-slot=entity-metadata]]:pt-0 [&_[data-slot=page-title]]:text-lg sm:mx-0 sm:rounded-lg sm:border-x sm:[&_[data-slot=entity-metadata]]:border-t sm:[&_[data-slot=entity-metadata]]:bg-muted/38 sm:[&_[data-slot=entity-metadata]]:pt-2.5 sm:[&_[data-slot=page-title]]:text-2xl"
        icon={GitPullRequest}
        expandableTitle
        backAction={backAction}
        eyebrow={
          <>
            <span className="font-mono text-primary">PR #{pr.number}</span>
            <span className="text-border">/</span>
            <span className="truncate">{pr.full_name}</span>
          </>
        }
        title={
          <span>
            {pr.title}
            {details?.labels.slice(0, 3).map((label) => (
              <Badge
                key={label.name}
                variant="outline"
                className="hidden h-6 max-w-36 shrink-0 truncate px-2 font-mono text-[11px] lg:inline-flex"
              >
                {label.name}
              </Badge>
            ))}
          </span>
        }
        badges={
          <Badge
            variant="outline"
            className={cn(
              'h-6 shrink-0 rounded-full px-2 text-xs',
              details?.isDraft ? 'border-slate-500/40 text-slate-300' : 'border-emerald-500/40 text-emerald-400',
            )}
          >
            <CircleDot className="size-3" />
            {details?.isDraft ? 'Draft' : 'Open'}
          </Badge>
        }
        metadata={
          details ? (
            <>
              <span className="hidden min-w-0 truncate sm:inline">
                <span className="mr-1.5 text-[10px] uppercase tracking-[.12em]">Author</span>
                <strong className="font-medium text-foreground/85">{details.author.login}</strong>
              </span>
              {details.assignees.length ? (
                <span className="min-w-0 truncate" title={details.assignees.map((person) => person.login).join(', ')}>
                  <span className="mr-1.5 text-[10px] uppercase tracking-[.12em]">Assignee</span>
                  <strong className="font-medium text-foreground/85">{details.assignees[0].login}</strong>
                  {details.assignees.length > 1 ? ` +${details.assignees.length - 1}` : ''}
                </span>
              ) : (
                <span className="hidden text-muted-foreground sm:inline">Unassigned</span>
              )}
              <span className="hidden min-w-0 items-center gap-1.5 font-mono sm:flex">
                <GitBranch className="size-3 shrink-0" />
                <span className="truncate text-primary">{details.headRefName}</span>
                <span>→</span>
                <span className="truncate">{details.baseRefName}</span>
              </span>
              <span className="ml-auto">
                {details.changedFiles} files · <span className="text-emerald-400">+{details.additions}</span> ·{' '}
                <span className="text-red-400">−{details.deletions}</span>
              </span>
              <span className="hidden sm:inline">
                opened {age(details.createdAt)} · updated {age(details.updatedAt)}
              </span>
            </>
          ) : (
            <span>Loading {providerName} context…</span>
          )
        }
        actions={
          <>
            {relatedMenu}
            {headerActions}
          </>
        }
      />
    </div>
  )
}

function PullRequestRelatedMenu({ pr }: { pr: PullRequestDialogItem }) {
  if (!pr.work_item_key && !pr.latest_agent_review_id) return null
  return (
    <span className="flex items-center gap-1">
      {pr.work_item_key ? (
        <a className="text-xs text-blue-400 hover:underline" href={`/work/${pr.work_item_key}`}>
          {pr.work_item_key}
        </a>
      ) : null}
      {pr.latest_agent_review_id ? (
        <a className="text-xs text-blue-400 hover:underline" href={`/threads/${pr.latest_agent_review_id}`}>
          Review #{pr.latest_agent_review_id}
        </a>
      ) : null}
    </span>
  )
}

export function PullRequestDecisionBar({
  details,
  actions,
  mobileDock = false,
}: {
  details: PullRequestDetails
  actions?: PrDetailsActions
  mobileDock?: boolean
}) {
  const checks = checkSummary(details.statusCheckRollup)
  const review = reviewSummary(details.reviewDecision)
  const merge = mergeSummary(details)
  const decision = pullRequestNextDecision(details)
  const threadStatus = reviewThreadStatus(details.reviewThreads)
  return (
    <section
      data-slot="pull-request-decision"
      className="mx-3 mb-2 shrink-0 rounded-lg border border-border/70 bg-card/55 px-3 py-2.5 sm:mx-0 sm:mb-0 sm:rounded-none sm:border-x-0 sm:border-t-0 sm:bg-card/36 sm:px-5 sm:py-3"
    >
      <div className="grid w-full gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,.9fr)] xl:grid-cols-[minmax(16rem,1fr)_minmax(24rem,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 hidden size-8 shrink-0 place-items-center rounded-md border border-amber-500/25 bg-amber-500/[.06] text-amber-400 sm:grid">
            <FileSearch className="size-4" />
          </span>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-muted-foreground">Next decision</span>
            <h2 className="mt-0.5 text-sm font-semibold">{decision.title}</h2>
            <p className="mt-1 hidden text-xs leading-relaxed text-muted-foreground sm:block">{decision.detail}</p>
            {threadStatus ? <p className="mt-1.5 text-[11px] text-muted-foreground">{threadStatus}</p> : null}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-2 sm:gap-5 sm:rounded-lg sm:border sm:bg-background/30 sm:px-2.5 sm:py-2 lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l lg:bg-transparent lg:py-1 lg:pl-4">
          <DetailSignal label="Checks" value={checks.label} className={checks.className} dot={checks.dot} />
          <DetailSignal label="Review" value={review.label} className={review.className} dot={review.dot} />
          <DetailSignal label="Merge" value={merge.label} className={merge.className} dot={merge.dot} />
        </div>
        <DetailActions actions={actions} mobileDock={mobileDock} />
      </div>
    </section>
  )
}

function reviewThreadStatus(threads: PullRequestDetails['reviewThreads']) {
  const unresolved = threads.filter((thread) => !thread.isResolved).length
  const outdated = threads.filter((thread) => thread.isOutdated).length
  const labels = []
  if (unresolved) labels.push(`${unresolved} unresolved thread${unresolved === 1 ? '' : 's'}`)
  if (outdated) labels.push(`${outdated} outdated`)
  return labels.join(' · ')
}

export function PullRequestOverview({
  pr,
  details,
  onOpenRun,
}: {
  pr: PullRequestDialogItem
  details: PullRequestDetails
  onOpenRun?: (jobId: number) => void
}) {
  return (
    <EntityWorkspace
      className="xl:grid-cols-[minmax(0,1fr)_20rem]"
      inspector={
        <>
          <EntityInspectorSection eyebrow="Scope" title="Change set">
            <div className="grid grid-cols-3">
              {[
                ['Files', details.changedFiles],
                ['Added', `+${details.additions}`],
                ['Deleted', `−${details.deletions}`],
              ].map(([label, value]) => (
                <div key={label} className="border-r border-border/55 p-3 text-center last:border-r-0">
                  <strong
                    className={cn(
                      'block font-mono text-sm',
                      label === 'Added' && 'text-emerald-400',
                      label === 'Deleted' && 'text-red-400',
                    )}
                  >
                    {value}
                  </strong>
                  <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </EntityInspectorSection>
          <EntityInspectorSection eyebrow="Automation" title="Agent review">
            <AgentReviewCard pr={pr} onOpenRun={onOpenRun} />
          </EntityInspectorSection>
        </>
      }
    >
      <PullRequestDescription details={details} />
    </EntityWorkspace>
  )
}

function PullRequestDescription({ details }: { details: PullRequestDetails }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = details.body.length > 1_800
  return (
    <section className="min-w-0 overflow-hidden border-y border-border/65 bg-card/48 backdrop-blur-sm sm:rounded-lg sm:border">
      <PullRequestDescriptionHeader collapsible={collapsible} expanded={expanded} />
      <PullRequestDescriptionBody details={details} clipped={collapsible && !expanded} />
      <PullRequestDescriptionToggle collapsible={collapsible} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    </section>
  )
}

function PullRequestDescriptionHeader({ collapsible, expanded }: { collapsible: boolean; expanded: boolean }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border/55 px-3 py-2.5 sm:px-4">
      <div>
        <span className="text-[10px] font-medium uppercase tracking-[.14em] text-muted-foreground">Context</span>
        <h3 className="mt-0.5 text-xs font-semibold">Pull request description</h3>
      </div>
      {collapsible && <span className="text-[11px] text-muted-foreground">{expanded ? 'Full context' : 'Focused preview'}</span>}
    </header>
  )
}

function PullRequestDescriptionBody({ details, clipped }: { details: PullRequestDetails; clipped: boolean }) {
  return (
    <div className="relative min-w-0">
      <div className={cn('min-w-0 p-3 sm:p-4', { 'max-h-[28rem] overflow-hidden': clipped })}>
        <PullRequestDescriptionMarkdown details={details} />
      </div>
      <PullRequestDescriptionFade visible={clipped} />
    </div>
  )
}

function PullRequestDescriptionMarkdown({ details }: { details: PullRequestDetails }) {
  if (!details.body) return <p className="text-sm text-muted-foreground">No description provided.</p>
  return (
    <MarkdownContent
      content={details.body}
      linkBaseUrl={details.url}
      referencePresentation={details.reference_presentation ?? undefined}
      className="min-w-0 max-w-full [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto"
    />
  )
}

function PullRequestDescriptionFade({ visible }: { visible: boolean }) {
  if (!visible) return null
  return <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-card via-card/90 to-transparent" />
}

function PullRequestDescriptionToggle({
  collapsible,
  expanded,
  onToggle,
}: {
  collapsible: boolean
  expanded: boolean
  onToggle: () => void
}) {
  if (!collapsible) return null
  return (
    <div className="border-t border-border/55 p-2 text-center">
      <Button type="button" variant="ghost" size="sm" onClick={onToggle}>
        {expanded ? 'Show less' : 'Show full description'}
        <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
      </Button>
    </div>
  )
}

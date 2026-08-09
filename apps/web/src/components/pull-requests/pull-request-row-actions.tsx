import type { ReactNode } from 'react'
import {
  Check,
  ExternalLink,
  FileSearch,
  GitBranch,
  GitFork,
  GitMerge,
  GitPullRequest,
  ListChecks,
  MoreHorizontal,
  RefreshCw,
  Tags,
  UserRoundPlus,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import type { DashboardData, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import { type PullRequestActionId, type PullRequestActionRecommendation } from '../../lib/pull-request-action-policy'

export type PrActionHandlers = {
  work(): void
  review(): void
  details(): void
  ready(): void
  update(): void
  autoMerge(): void
}

type PrQuickActionsProps = {
  pr: PullRequest
  handlers: PrActionHandlers
  scm: DashboardData['presentation']['scm']
  recommendation: PullRequestActionRecommendation
  authoredByMe: boolean
  assignedToMe: boolean
  addingToWork: boolean
  assigningMe: boolean
  readinessBusy: boolean
  onAddToWork(): void
  onFork(): void
  onLabels(): void
  onReviewers(): void
  onAssignMe(): void
  onReadiness(): void
}

const prActionIcons: Record<PullRequestActionId, LucideIcon> = {
  ready: Check,
  work: GitBranch,
  update: RefreshCw,
  review: FileSearch,
  details: GitPullRequest,
  merge: GitMerge,
}

function recommendationHandler(recommendation: PullRequestActionRecommendation, handlers: PrActionHandlers) {
  if (recommendation.id === 'merge') return handlers.autoMerge
  return handlers[recommendation.id]
}

function UpdateMenuItem({ pr, onUpdate }: { pr: PullRequest; onUpdate(): void }) {
  if (pr.merge_state_status !== 'BEHIND') return null
  return (
    <DropdownMenuItem onSelect={onUpdate}>
      <RefreshCw />
      Update branch
    </DropdownMenuItem>
  )
}

function ReadyMenuItem({ pr, onReady }: { pr: PullRequest; onReady(): void }) {
  if (!pr.draft) return null
  return (
    <DropdownMenuItem onSelect={onReady}>
      <Check />
      Mark ready for review
    </DropdownMenuItem>
  )
}

function AssignMenuItem({
  assignedToMe,
  authoredByMe,
  busy,
  onAssignMe,
}: {
  assignedToMe: boolean
  authoredByMe: boolean
  busy: boolean
  onAssignMe(): void
}) {
  if (assignedToMe) return null
  if (authoredByMe) return null
  return (
    <DropdownMenuItem disabled={busy} onSelect={onAssignMe}>
      <UserRoundPlus />
      Assign me as reviewer
    </DropdownMenuItem>
  )
}

function readinessLabel(pr: PullRequest) {
  return pr.manual_not_ready_at ? 'Clear not ready' : 'Mark not ready'
}

function autoMergeLabel(pr: PullRequest) {
  return pr.auto_merge_enabled ? 'Auto-merge enabled' : 'Enable auto-merge'
}

function PrMoreMenu({
  pr,
  handlers,
  scm,
  authoredByMe,
  assignedToMe,
  addingToWork,
  assigningMe,
  readinessBusy,
  onAddToWork,
  onFork,
  onLabels,
  onReviewers,
  onAssignMe,
  onReadiness,
}: {
  pr: PullRequest
  handlers: PrActionHandlers
  scm: DashboardData['presentation']['scm']
  authoredByMe: boolean
  assignedToMe: boolean
  addingToWork: boolean
  assigningMe: boolean
  readinessBusy: boolean
  onAddToWork(): void
  onFork(): void
  onLabels(): void
  onReviewers(): void
  onAssignMe(): void
  onReadiness(): void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" className="max-lg:size-8" aria-label={`More ${scm.changeRequestLabel} actions`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>#{pr.number} actions</DropdownMenuLabel>
        <DropdownMenuItem onSelect={handlers.work}>
          <GitBranch />
          Start work
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handlers.review}>
          <FileSearch />
          Start agent review
        </DropdownMenuItem>
        <DropdownMenuItem disabled={addingToWork} onSelect={onAddToWork}>
          <ListChecks />
          Add as review task
        </DropdownMenuItem>
        <DropdownMenuItem disabled={Boolean(pr.draft) || Boolean(pr.auto_merge_enabled)} onSelect={handlers.autoMerge}>
          <GitMerge />
          {autoMergeLabel(pr)}
        </DropdownMenuItem>
        <UpdateMenuItem pr={pr} onUpdate={handlers.update} />
        <ReadyMenuItem pr={pr} onReady={handlers.ready} />
        <AssignMenuItem assignedToMe={assignedToMe} authoredByMe={authoredByMe} busy={assigningMe} onAssignMe={onAssignMe} />
        <DropdownMenuItem disabled={readinessBusy} onSelect={onReadiness}>
          <X />
          {readinessLabel(pr)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLabels}>
          <Tags />
          Edit labels
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onReviewers}>
          <UserRoundPlus />
          Manage reviewers
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onFork}>
          <GitFork />
          Fork from this {scm.changeRequestLabel}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={pr.url} target="_blank" rel="noreferrer">
            <ExternalLink />
            Open on {scm.name}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MobilePrQuickActions({
  handlers,
  recommendation,
  more,
}: Pick<PrQuickActionsProps, 'handlers' | 'recommendation'> & {
  more: ReactNode
}) {
  const primary = {
    Icon: prActionIcons[recommendation.id],
    label: recommendation.label,
    disabled: Boolean(recommendation.disabled),
    onClick: recommendationHandler(recommendation, handlers),
  }
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] gap-1 lg:hidden">
      <Button size="xs" className="min-w-0 justify-center shadow-none" disabled={primary.disabled} onClick={primary.onClick}>
        <primary.Icon />
        <span className="truncate">{primary.label}</span>
      </Button>
      {more}
    </div>
  )
}

export function PrQuickActions({
  pr,
  handlers,
  scm,
  recommendation,
  authoredByMe,
  assignedToMe,
  addingToWork,
  assigningMe,
  readinessBusy,
  onAddToWork,
  onFork,
  onLabels,
  onReviewers,
  onAssignMe,
  onReadiness,
}: PrQuickActionsProps) {
  const PrimaryIcon = prActionIcons[recommendation.id]
  const primaryHandler = recommendationHandler(recommendation, handlers)
  const more = (
    <PrMoreMenu
      pr={pr}
      handlers={handlers}
      scm={scm}
      authoredByMe={authoredByMe}
      assignedToMe={assignedToMe}
      addingToWork={addingToWork}
      assigningMe={assigningMe}
      readinessBusy={readinessBusy}
      onAddToWork={onAddToWork}
      onFork={onFork}
      onLabels={onLabels}
      onReviewers={onReviewers}
      onAssignMe={onAssignMe}
      onReadiness={onReadiness}
    />
  )
  return (
    <>
      <MobilePrQuickActions handlers={handlers} recommendation={recommendation} more={more} />
      <div className="hidden min-w-0 grid-cols-[minmax(0,1fr)_2.25rem] gap-1 lg:grid">
        <Button size="xs" className="w-full min-w-0 justify-center" disabled={recommendation.disabled} onClick={primaryHandler}>
          <PrimaryIcon />
          <span className="truncate">{recommendation.label}</span>
        </Button>
        {more}
      </div>
    </>
  )
}

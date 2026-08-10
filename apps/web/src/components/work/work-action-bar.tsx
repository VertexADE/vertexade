import {
  AlertTriangle,
  Archive,
  Bot,
  CheckCircle2,
  Copy,
  FileSearch,
  GitPullRequest,
  MoreHorizontal,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { ActionSheet, type ActionSheetSection } from '@vertexade/ui/components/ui/action-sheet'
import { Button } from '@vertexade/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { useIsMobile } from '@vertexade/ui/hooks/use-mobile'
import { agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { activeWorkJob, latestWorkJob } from './work-focus-panel'
import { attentionRetryLabel, workAttentionPresentation } from './work-attention-presentation'

type WorkJob = WorkItem['threads'][number]
type WorkResource = WorkItem['resources'][number]

type WorkAction = { label: string; icon: typeof Bot; onClick(): void; disabled?: boolean }

type WorkActions = {
  openRun(jobId: number): void
  openPullRequest(resource: WorkResource): void
  startWork(): void
  startReview(): void
}

function activeWorkAction(active: WorkJob | undefined, actions: WorkActions): WorkAction | null {
  if (!active) return null
  return {
    label: `${agentThreadState(active) === 'waiting' ? 'Answer' : 'Open'} thread #${active.id}`,
    icon: Play,
    onClick: () => actions.openRun(active.id),
  }
}

function pullRequestWorkAction(item: WorkItem, pullRequest: WorkResource | undefined, actions: WorkActions): WorkAction | null {
  if (item.state !== 'review') return null
  if (!pullRequest) return null
  return {
    label: 'Review pull request',
    icon: GitPullRequest,
    onClick: () => actions.openPullRequest(pullRequest),
  }
}

function attentionWorkAction(item: WorkItem, actions: WorkActions): WorkAction | null {
  const attention = workAttentionPresentation(item)
  if (!attention) return null
  const label = attentionRetryLabel(item, attention.kind)
  if (!label) return null
  return {
    label,
    icon: RotateCcw,
    onClick: actions.startWork,
    disabled: item.context_transfers.length > 0,
  }
}

function resultWorkAction(item: WorkItem, actions: WorkActions): WorkAction | null {
  const latest = latestWorkJob(item)
  if (!latest) return null
  const state = agentThreadState(latest)
  if (state === 'failed')
    return {
      label: 'Inspect failed thread',
      icon: AlertTriangle,
      onClick: () => actions.openRun(latest.id),
    }
  if (state !== 'completed') return null
  return {
    label: item.state === 'done' ? 'View completed result' : 'Review agent result',
    icon: CheckCircle2,
    onClick: () => actions.openRun(latest.id),
  }
}

function reviewWorkAction(item: WorkItem, actions: WorkActions): WorkAction | null {
  if (item.kind !== 'pr_review') return null
  return {
    label: 'Start review thread',
    icon: FileSearch,
    onClick: actions.startWork,
    disabled: item.context_transfers.length > 0,
  }
}

function defaultWorkAction(item: WorkItem, actions: WorkActions): WorkAction {
  const label = item.threads.length ? 'Start next agent thread' : 'Start first agent thread'
  return {
    label,
    icon: Bot,
    onClick: actions.startWork,
    disabled: item.context_transfers.length > 0,
  }
}

function recommendedWorkAction(item: WorkItem, pullRequest: WorkResource | undefined, actions: WorkActions) {
  const recommendation = [
    activeWorkAction(activeWorkJob(item), actions),
    attentionWorkAction(item, actions),
    pullRequestWorkAction(item, pullRequest, actions),
    resultWorkAction(item, actions),
    reviewWorkAction(item, actions),
  ].find(Boolean)
  return recommendation ? recommendation : defaultWorkAction(item, actions)
}

function WorkReviewButton({ item, onStartReview }: { item: WorkItem; onStartReview(): void }) {
  if (item.kind === 'pr_review') return null
  return (
    <Button className="hidden sm:inline-flex" variant="outline" size="sm" onClick={onStartReview}>
      <FileSearch />
      Agent review
    </Button>
  )
}

function WorkResourceButton({
  pullRequest,
  onOpenPullRequest,
  onCopy,
}: {
  pullRequest?: WorkResource
  onOpenPullRequest(resource: WorkResource): void
  onCopy(): void
}) {
  if (!pullRequest)
    return (
      <Button className="hidden sm:inline-flex" variant="outline" size="sm" onClick={onCopy}>
        <Copy />
        Copy link
      </Button>
    )
  return (
    <Button className="hidden sm:inline-flex" variant="outline" size="sm" onClick={() => onOpenPullRequest(pullRequest)}>
      <GitPullRequest />
      View PR
    </Button>
  )
}

function WorkReviewMenuItem({ item, onStartReview }: { item: WorkItem; onStartReview(): void }) {
  if (item.kind === 'pr_review') return null
  return (
    <DropdownMenuItem data-audit-action="work.thread.new-review" onSelect={onStartReview}>
      <FileSearch />
      New review thread
    </DropdownMenuItem>
  )
}

function WorkPullRequestMenuItem({
  pullRequest,
  onOpenPullRequest,
}: {
  pullRequest?: WorkResource
  onOpenPullRequest(resource: WorkResource): void
}) {
  if (!pullRequest) return null
  return (
    <DropdownMenuItem onSelect={() => onOpenPullRequest(pullRequest)}>
      <GitPullRequest />
      View pull request
    </DropdownMenuItem>
  )
}

type WorkMoreMenuProps = {
  item: WorkItem
  pullRequest?: WorkResource
  onOpenPullRequest(resource: WorkResource): void
  onStartWork(): void
  onStartReview(): void
  onCopy(): void
  onArchive(): void
  onDelete(): void
}

function mobileWorkSections({
  item,
  pullRequest,
  onOpenPullRequest,
  onStartWork,
  onStartReview,
  onCopy,
  onArchive,
  onDelete,
}: WorkMoreMenuProps): ActionSheetSection[] {
  return [
    {
      id: 'work',
      label: 'Continue work',
      actions: [
        {
          id: 'new-run',
          label: 'New agent thread',
          auditAction: 'work.thread.new-agent',
          description: 'Continue this outcome in its existing workspace.',
          icon: Bot,
          disabled: item.context_transfers.length > 0,
          onSelect: onStartWork,
        },
        ...(item.kind === 'pr_review'
          ? []
          : [
              {
                id: 'review',
                label: 'New review thread',
                auditAction: 'work.thread.new-review',
                description: 'Inspect the current shared implementation in a read-only review.',
                icon: FileSearch,
                onSelect: onStartReview,
              },
            ]),
        ...(pullRequest
          ? [
              {
                id: 'pull-request',
                label: 'View pull request',
                description: pullRequest.label,
                icon: GitPullRequest,
                onSelect: () => onOpenPullRequest(pullRequest),
              },
            ]
          : []),
      ],
    },
    {
      id: 'organize',
      label: 'Organize',
      actions: [
        { id: 'copy', label: 'Copy Work link', icon: Copy, onSelect: onCopy },
        {
          id: 'archive',
          label: 'Archive Work',
          description: 'Keep the outcome and its history out of active views.',
          icon: Archive,
          onSelect: onArchive,
        },
      ],
    },
    {
      id: 'danger',
      label: 'Danger zone',
      actions: [
        {
          id: 'delete',
          label: 'Delete Work permanently',
          auditAction: 'work.delete',
          description: 'Remove the Work item and disposable local execution state.',
          icon: Trash2,
          destructive: true,
          onSelect: onDelete,
        },
      ],
    },
  ]
}

function MobileWorkMoreMenu(props: WorkMoreMenuProps) {
  return (
    <ActionSheet
      title={`${props.item.key} actions`}
      description="Choose what to do with this Work item."
      trigger={
        <Button data-audit-action="work.actions.open" variant="outline" size="icon-sm" aria-label="More Work actions">
          <MoreHorizontal />
        </Button>
      }
      sections={mobileWorkSections(props)}
    />
  )
}

function DesktopWorkMoreMenu({
  item,
  pullRequest,
  onOpenPullRequest,
  onStartWork,
  onStartReview,
  onCopy,
  onArchive,
  onDelete,
}: WorkMoreMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-audit-action="work.actions.open" variant="outline" size="icon-sm" aria-label="More Work actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{item.key} actions</DropdownMenuLabel>
        <DropdownMenuItem data-audit-action="work.thread.new-agent" disabled={item.context_transfers.length > 0} onSelect={onStartWork}>
          <Bot />
          New agent thread
        </DropdownMenuItem>
        <WorkReviewMenuItem item={item} onStartReview={onStartReview} />
        <WorkPullRequestMenuItem pullRequest={pullRequest} onOpenPullRequest={onOpenPullRequest} />
        <DropdownMenuItem onSelect={onCopy}>
          <Copy />
          Copy Work link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onArchive}>
          <Archive />
          Archive Work
        </DropdownMenuItem>
        <DropdownMenuItem data-audit-action="work.delete" variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete Work permanently
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WorkMoreMenu(props: WorkMoreMenuProps) {
  return useIsMobile() ? <MobileWorkMoreMenu {...props} /> : <DesktopWorkMoreMenu {...props} />
}

export function WorkActionBar({
  item,
  pullRequest,
  onOpenRun,
  onOpenPullRequest,
  onStartWork,
  onStartReview,
  onCopy,
  onArchive,
  onDelete,
}: {
  item: WorkItem
  pullRequest?: WorkResource
  onOpenRun(jobId: number): void
  onOpenPullRequest(resource: WorkResource): void
  onStartWork(): void
  onStartReview(): void
  onCopy(): void
  onArchive(): void
  onDelete(): void
}) {
  const recommended = recommendedWorkAction(item, pullRequest, {
    openRun: onOpenRun,
    openPullRequest: onOpenPullRequest,
    startWork: onStartWork,
    startReview: onStartReview,
  })
  const RecommendedIcon = recommended.icon
  return (
    <div data-slot="work-actions" className="min-w-0 border-t px-3 py-2 md:border-l md:border-t-0 md:p-3">
      <div className="flex min-w-0 justify-end gap-2 sm:grid sm:grid-cols-[minmax(12rem,1fr)_auto_auto_auto]">
        <Button className="min-w-0 flex-1 shadow-sm sm:max-w-none" size="sm" disabled={recommended.disabled} onClick={recommended.onClick}>
          <RecommendedIcon />
          <span className="truncate">{recommended.label}</span>
        </Button>
        <WorkReviewButton item={item} onStartReview={onStartReview} />
        <WorkResourceButton pullRequest={pullRequest} onOpenPullRequest={onOpenPullRequest} onCopy={onCopy} />
        <WorkMoreMenu
          item={item}
          pullRequest={pullRequest}
          onOpenPullRequest={onOpenPullRequest}
          onStartWork={onStartWork}
          onStartReview={onStartReview}
          onCopy={onCopy}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}

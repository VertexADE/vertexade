import {
  ArrowRightLeft,
  CopyPlus,
  ExternalLink,
  Link2,
  ListPlus,
  Loader2,
  MessageSquarePlus,
  MessageSquareText,
  MoreHorizontal,
  RotateCcw,
  Square,
  Terminal,
} from 'lucide-react'
import type { JobLog } from '@vertexade/ui/lib/dashboard-types'
import type { ThreadOutcome } from '@vertexade/ui/lib/thread-outcome'
import { cn } from '@vertexade/ui/lib/utils'
import { Button, buttonVariants } from '@vertexade/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'

type ThreadPanelActionsProps = {
  activityOnly: boolean
  job: JobLog | null
  outcome: ThreadOutcome | null
  savingTasks: boolean
  retrying: boolean
  stopping: boolean
  reReviewing: boolean
  onClose?: () => void
  onHandoff?: (job: JobLog) => void
  onSubmitReview?: (job: JobLog) => void
  onSaveTasks(): void
  onCopyLink(): void
  onRetry(): void
  onStop(): void
  onReReview(): void
  onFork(job: JobLog): void
  onTransfer(job: JobLog): void
}

type ActionAvailability = ReturnType<typeof getThreadActionAvailability> & {
  canSaveTasks: boolean
  canUseFindings: boolean
}

export function getThreadActionAvailability(job: JobLog | null) {
  const canFork = Boolean(job?.thread_id && !['running', 'starting'].includes(job.status))
  return {
    canTransfer: Boolean(
      job?.work_item_id && !['running', 'starting'].includes(job.status) && (job.result_text || job.review_details || job.review_summary),
    ),
    canFork,
    canForkOnDesktop: canFork && !job?.ephemeral,
  }
}

export function ThreadPanelActions(props: ThreadPanelActionsProps) {
  const availability = actionAvailability(props)
  return (
    <>
      <MobileThreadActions props={props} availability={availability} />
      <DesktopThreadActions props={props} availability={availability} />
    </>
  )
}

function actionAvailability({ job, onHandoff }: ThreadPanelActionsProps): ActionAvailability {
  return {
    ...getThreadActionAvailability(job),
    canSaveTasks: job?.kind === 'stack_analysis' && job.status === 'completed' && Boolean(job.result_text),
    canUseFindings: Boolean(onHandoff && job?.kind === 'review' && job.status === 'completed' && job.result_text),
  }
}

function PrimaryRunAction(
  props: Pick<
    ThreadPanelActionsProps,
    'job' | 'outcome' | 'retrying' | 'stopping' | 'reReviewing' | 'onClose' | 'onRetry' | 'onStop' | 'onReReview' | 'onSubmitReview'
  >,
) {
  const kind = primaryActionKind(props.job, props.onSubmitReview)
  if (kind === 'stop') return <StopAction stopping={props.stopping} onStop={props.onStop} />
  if (kind === 'retry') return <RetryAction job={props.job} outcome={props.outcome} retrying={props.retrying} onRetry={props.onRetry} />
  if (kind === 'review') return <ReReviewAction reReviewing={props.reReviewing} onReReview={props.onReReview} />
  if (kind === 'submit-review' && props.job && props.onSubmitReview)
    return <SubmitReviewAction job={props.job} onSubmitReview={props.onSubmitReview} />
  return <CloseAction onClose={props.onClose} />
}

function primaryActionKind(job: JobLog | null, onSubmitReview?: (job: JobLog) => void) {
  if (!job) return 'close'
  const statusAction = RUN_STATUS_ACTIONS[job.status]
  if (statusAction) return statusAction
  if (onSubmitReview && REVIEWABLE_RUNS.has(`${job.kind}:${job.status}:${Boolean(job.pr_closed_at)}`)) return 'submit-review'
  if (REVIEWABLE_RUNS.has(`${job.kind}:${job.status}:${Boolean(job.pr_closed_at)}`)) return 'review'
  return 'close'
}

const RUN_STATUS_ACTIONS: Partial<Record<JobLog['status'], 'stop' | 'retry'>> = {
  starting: 'stop',
  running: 'stop',
  failed: 'retry',
  resumable: 'retry',
  cancelled: 'retry',
}

const REVIEWABLE_RUNS = new Set(['review:completed:false'])

function SubmitReviewAction({ job, onSubmitReview }: { job: JobLog; onSubmitReview(job: JobLog): void }) {
  return (
    <Button size="sm" onClick={() => onSubmitReview(job)}>
      <MessageSquareText />
      Submit review
    </Button>
  )
}

export function StopAction({ stopping, onStop }: Pick<ThreadPanelActionsProps, 'stopping' | 'onStop'>) {
  return (
    <Button size="sm" variant="destructive" disabled={stopping} onClick={() => void onStop()}>
      {stopping ? <Loader2 className="animate-spin" /> : <Square />}
      {stopping ? 'Interrupting…' : 'Interrupt thread'}
    </Button>
  )
}

function RetryAction({ job, outcome, retrying, onRetry }: Pick<ThreadPanelActionsProps, 'job' | 'outcome' | 'retrying' | 'onRetry'>) {
  return (
    <Button size="sm" disabled={retrying} onClick={() => void onRetry()}>
      <RotateCcw className={cn(retrying && 'animate-spin')} />
      {retryActionLabel(job, outcome, retrying)}
    </Button>
  )
}

function retryActionLabel(job: JobLog | null, outcome: ThreadOutcome | null, retrying: boolean) {
  if (retrying) return job?.status === 'resumable' ? 'Resuming…' : 'Retrying…'
  if (job?.status === 'resumable') return 'Resume task'
  return outcome?.outputReady ? 'Retry follow-up' : 'Retry task'
}

function ReReviewAction({ reReviewing, onReReview }: Pick<ThreadPanelActionsProps, 'reReviewing' | 'onReReview'>) {
  return (
    <Button size="sm" disabled={reReviewing} onClick={() => void onReReview()}>
      <RotateCcw className={cn(reReviewing && 'animate-spin')} />
      {reReviewing ? 'Starting…' : 'Re-review'}
    </Button>
  )
}

function CloseAction({ onClose }: Pick<ThreadPanelActionsProps, 'onClose'>) {
  return (
    <Button size="sm" variant="secondary" disabled={!onClose} onClick={onClose}>
      <Terminal />
      Close
    </Button>
  )
}

function MobileThreadActions({ props, availability }: { props: ThreadPanelActionsProps; availability: ActionAvailability }) {
  return (
    <div
      hidden={props.activityOnly}
      className="flex shrink-0 items-center justify-end gap-2 border-t bg-background/95 p-3 backdrop-blur sm:hidden"
    >
      <PrimaryRunAction {...props} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <MoreHorizontal />
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-64">
          <DropdownMenuLabel>Run actions</DropdownMenuLabel>
          <MobileActionItems props={props} availability={availability} />
          <DropdownMenuSeparator />
          {props.onClose ? (
            <DropdownMenuItem className="min-h-11" onSelect={props.onClose}>
              <Terminal />
              Close
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function MobileActionItems({ props, availability }: { props: ThreadPanelActionsProps; availability: ActionAvailability }) {
  return (
    <>
      <MobileSaveTasksAction props={props} visible={availability.canSaveTasks} />
      <MobileUseFindingsAction props={props} visible={availability.canUseFindings} />
      <MobileReReviewAction props={props} visible={primaryActionKind(props.job, props.onSubmitReview) === 'submit-review'} />
      <MobileCopyLinkAction props={props} />
      <MobileOpenThreadAction job={props.job} />
      <MobileTransferAction props={props} visible={availability.canTransfer} />
      <MobileForkAction props={props} visible={availability.canFork} />
    </>
  )
}

function MobileReReviewAction({ props, visible }: { props: ThreadPanelActionsProps; visible: boolean }) {
  if (!visible) return null
  return (
    <DropdownMenuItem className="min-h-11" disabled={props.reReviewing} onSelect={() => void props.onReReview()}>
      <RotateCcw />
      Re-review
    </DropdownMenuItem>
  )
}

function MobileSaveTasksAction({ props, visible }: { props: ThreadPanelActionsProps; visible: boolean }) {
  if (!visible) return null
  return (
    <DropdownMenuItem className="min-h-11" disabled={props.savingTasks} onSelect={() => void props.onSaveTasks()}>
      <ListPlus />
      Save as tasks
    </DropdownMenuItem>
  )
}

function MobileUseFindingsAction({ props, visible }: { props: ThreadPanelActionsProps; visible: boolean }) {
  if (!visible || !props.job) return null
  return (
    <DropdownMenuItem className="min-h-11" onSelect={() => props.onHandoff?.(props.job!)}>
      <MessageSquarePlus />
      Use findings
    </DropdownMenuItem>
  )
}

function MobileCopyLinkAction({ props }: { props: ThreadPanelActionsProps }) {
  if (!props.job) return null
  return (
    <DropdownMenuItem className="min-h-11" onSelect={() => void props.onCopyLink()}>
      <Link2 />
      Copy link
    </DropdownMenuItem>
  )
}

function MobileOpenThreadAction({ job }: { job: JobLog | null }) {
  if (!job?.thread_url) return null
  return (
    <DropdownMenuItem className="min-h-11" asChild>
      <a href={job.thread_url}>
        <ExternalLink />
        Open in {job.agent_name}
      </a>
    </DropdownMenuItem>
  )
}

function MobileTransferAction({ props, visible }: { props: ThreadPanelActionsProps; visible: boolean }) {
  if (!visible || !props.job) return null
  return (
    <DropdownMenuItem className="min-h-11" onSelect={() => props.onTransfer(props.job!)}>
      <ArrowRightLeft />
      Send to worktree
    </DropdownMenuItem>
  )
}

function MobileForkAction({ props, visible }: { props: ThreadPanelActionsProps; visible: boolean }) {
  if (!visible || !props.job) return null
  return (
    <DropdownMenuItem className="min-h-11" onSelect={() => props.onFork(props.job!)}>
      <CopyPlus />
      Fork
    </DropdownMenuItem>
  )
}

function DesktopThreadActions({ props, availability }: { props: ThreadPanelActionsProps; availability: ActionAvailability }) {
  return (
    <footer
      hidden={props.activityOnly}
      className="mx-0 mb-0 hidden flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-5 py-3 [&_a]:h-7 [&_button]:h-7 sm:flex"
    >
      <DesktopPrimaryActions props={props} availability={availability} />
      <DesktopSecondaryActions props={props} availability={availability} />
    </footer>
  )
}

function DesktopPrimaryActions({ props, availability }: { props: ThreadPanelActionsProps; availability: ActionAvailability }) {
  return (
    <div className="contents sm:flex sm:flex-wrap sm:gap-2">
      {primaryActionKind(props.job, props.onSubmitReview) !== 'close' ? <PrimaryRunAction {...props} /> : null}
      {availability.canSaveTasks ? (
        <Button variant="outline" size="sm" disabled={props.savingTasks} onClick={props.onSaveTasks}>
          <ListPlus />
          Save as tasks
        </Button>
      ) : null}
      {availability.canUseFindings && props.job ? (
        <Button variant="outline" size="sm" onClick={() => props.onHandoff?.(props.job!)}>
          <MessageSquarePlus />
          Use findings
        </Button>
      ) : null}
    </div>
  )
}

function DesktopSecondaryActions({ props, availability }: { props: ThreadPanelActionsProps; availability: ActionAvailability }) {
  return (
    <div className="contents sm:flex sm:flex-wrap sm:gap-2">
      <DesktopCopyLink props={props} />
      <DesktopOpenAgent props={props} />
      <DesktopTransfer props={props} available={availability.canTransfer} />
      <DesktopFork props={props} available={availability.canForkOnDesktop} />
      <DesktopReReview props={props} />
      <DesktopClose props={props} />
    </div>
  )
}

function DesktopCopyLink({ props }: { props: ThreadPanelActionsProps }) {
  if (!props.job) return null
  return (
    <Button variant="ghost" size="sm" onClick={() => void props.onCopyLink()}>
      <Link2 />
      Copy link
    </Button>
  )
}

function DesktopOpenAgent({ props }: { props: ThreadPanelActionsProps }) {
  if (!props.job?.thread_url) return null
  return (
    <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={props.job.thread_url}>
      <ExternalLink />
      Open in {props.job.agent_name}
    </a>
  )
}

function DesktopTransfer({ props, available }: { props: ThreadPanelActionsProps; available: boolean }) {
  if (!available || !props.job) return null
  return (
    <Button variant="outline" size="sm" onClick={() => props.onTransfer(props.job!)}>
      <ArrowRightLeft />
      Send to worktree
    </Button>
  )
}

function DesktopFork({ props, available }: { props: ThreadPanelActionsProps; available: boolean }) {
  if (!available || !props.job) return null
  return (
    <Button variant="outline" size="sm" onClick={() => props.onFork(props.job!)}>
      <CopyPlus />
      Fork
    </Button>
  )
}

function DesktopReReview({ props }: { props: ThreadPanelActionsProps }) {
  if (primaryActionKind(props.job, props.onSubmitReview) !== 'submit-review') return null
  return (
    <Button variant="outline" size="sm" disabled={props.reReviewing} onClick={props.onReReview}>
      <RotateCcw className={cn(props.reReviewing && 'animate-spin')} />
      {props.reReviewing ? 'Starting…' : 'Re-review'}
    </Button>
  )
}

function DesktopClose({ props }: { props: ThreadPanelActionsProps }) {
  if (!props.onClose) return null
  return (
    <Button variant="secondary" size="sm" onClick={props.onClose}>
      <Terminal />
      Close
    </Button>
  )
}

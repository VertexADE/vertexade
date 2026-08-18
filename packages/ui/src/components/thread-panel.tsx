import { useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, GitPullRequest, MoreHorizontal, Network } from 'lucide-react'
import { ForkThreadDialog } from '@vertexade/ui/components/fork-thread-dialog'
import { CrossWorktreeFollowUpDialog } from '@vertexade/ui/components/cross-worktree-follow-up-dialog'
import type { FileReference } from '@vertexade/ui/components/markdown-content'
import { LazySourceFileDialog } from '@vertexade/ui/components/lazy-source-file-dialog'
import { parseJson } from '@vertexade/ui/lib/dashboard-api'
import type { InputQuestion, Job, JobLog } from '@vertexade/ui/lib/dashboard-types'
import { threadOutcome } from '@vertexade/ui/lib/thread-outcome'
import { canShowFollowUpComposer } from '@vertexade/ui/lib/follow-up-delivery'
import { cn } from '@vertexade/ui/lib/utils'
import { Button } from '@vertexade/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { storedReviewResult } from '@vertexade/ui/lib/review-summary'
import {
  ThreadCompactHeader,
  ThreadDialogHeader,
  ThreadOutcomeBanner,
  threadHeaderClass,
} from '@vertexade/ui/components/thread-dialog-support'
import { ThreadInputRequestForm } from '@vertexade/ui/components/thread-input-request-form'
import { ThreadPanelActions } from '@vertexade/ui/components/thread-panel-actions'
import { ThreadPanelTabs } from '@vertexade/ui/components/thread-panel-tabs'
import { useThreadPanelActions } from '@vertexade/ui/hooks/use-thread-panel-actions'
import { useThreadPanelData } from '@vertexade/ui/hooks/use-thread-panel-data'

export type ThreadViewCallbacks = {
  onHandoff?: (job: JobLog) => void
  onSubmitReview?: (job: JobLog) => void
  onForked?: (job: Job) => void
  onReviewStarted?: (job: Job) => void
}

export type ThreadPanelProps = ThreadViewCallbacks & {
  jobId: number | null
  onClose?: () => void
  className?: string
  activityOnly?: boolean
  showCompactHeader?: boolean
}

export function ThreadPanel(props: ThreadPanelProps) {
  const workspace = useThreadPanelWorkspace(props)
  return (
    <>
      <ThreadPanelBody props={props} workspace={workspace} />
      <ThreadPanelDialogs props={props} workspace={workspace} />
    </>
  )
}

function useThreadPanelWorkspace({ jobId, activityOnly = false, onReviewStarted }: ThreadPanelProps) {
  const [fileReference, setFileReference] = useState<FileReference | null>(null)
  const [changesActive, setChangesActive] = useState(false)
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const data = useThreadPanelData(jobId, changesActive)

  useEffect(() => {
    setFileReference(null)
    setChangesActive(false)
    setActiveTab(null)
  }, [jobId])

  const questions = useMemo(() => parseJson<InputQuestion[]>(data.job?.input_questions, []), [data.job?.input_questions])
  const presentation = reviewPresentation(data.job, questions, activityOnly)
  const actions = useThreadPanelActions({
    jobId,
    job: data.job,
    setJob: data.setJob,
    questions,
    suggestions: data.suggestions,
    setSuggestions: data.setSuggestions,
    setFileReference,
    setActiveTab,
    setChangesActive,
    onReviewStarted,
  })

  return {
    data,
    actions,
    questions,
    presentation,
    fileReference,
    setFileReference,
    activeTab,
    setActiveTab,
    setChangesActive,
  }
}

function reviewPresentation(job: JobLog | null, questions: InputQuestion[], activityOnly: boolean) {
  const needsInput = questions.length > 0
  const outcome = job ? threadOutcome(job) : null
  const isCodeReview = job?.kind === 'review' || job?.kind === 'work_review'
  return {
    needsInput,
    outcome,
    isCodeReview,
    showFollowUpComposer: Boolean(job && canShowFollowUpComposer(job, { activityOnly, needsInput })),
    reviewResult: isCodeReview && job ? storedReviewResult(reviewResultInput(job)) : null,
    reviewDefaultTab: reviewDefaultTab(job, isCodeReview),
  }
}

function reviewResultInput(job: JobLog) {
  return {
    reviewPhase: job.review_phase,
    reviewDetails: job.review_details,
    reviewSummary: job.review_summary,
    resultText: job.result_text,
  }
}

function reviewDefaultTab(job: JobLog | null, isCodeReview: boolean) {
  if (!job) return 'activity'
  if (isCodeReview) return codeReviewDefaultTab(job)
  if (job.kind === 'stack_analysis' && job.result_text) return 'findings'
  return 'activity'
}

function codeReviewDefaultTab(job: JobLog) {
  if (job.review_summary) return 'summary'
  if (job.review_details) return 'findings'
  if (job.review_phase === 'details') return 'findings'
  return 'activity'
}

type ThreadPanelWorkspace = ReturnType<typeof useThreadPanelWorkspace>

function ThreadPanelBody({ props, workspace }: { props: ThreadPanelProps; workspace: ThreadPanelWorkspace }) {
  const { data, actions, presentation } = workspace
  const activityOnly = props.activityOnly ?? false
  const showCompactHeader = activityOnly && props.showCompactHeader
  return (
    <section data-slot="thread-panel" className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background', props.className)}>
      <header
        hidden={activityOnly && !showCompactHeader}
        className={cn(threadHeaderClass, 'relative pr-11', showCompactHeader && 'px-3 py-1.5 pr-11 sm:py-1.5')}
      >
        {showCompactHeader ? (
          <ThreadCompactHeader job={data.job} outcome={presentation.outcome} needsInput={presentation.needsInput} />
        ) : (
          <ThreadDialogHeader job={data.job} outcome={presentation.outcome} needsInput={presentation.needsInput} />
        )}
        <ThreadRelatedMenu job={data.job} />
      </header>
      {data.job && presentation.outcome && !activityOnly ? <ThreadOutcomeBanner outcome={presentation.outcome} /> : null}
      <ThreadInputSection workspace={workspace} />
      <ThreadTabsSection jobId={props.jobId} activityOnly={activityOnly} workspace={workspace} />
      <ThreadPanelActions
        activityOnly={activityOnly}
        composerOwnsRunControls={presentation.showFollowUpComposer}
        job={data.job}
        outcome={presentation.outcome}
        savingTasks={actions.savingTasks}
        retrying={actions.retrying}
        stopping={actions.stopping}
        reReviewing={actions.reReviewing}
        onClose={props.onClose}
        onHandoff={props.onHandoff}
        onSubmitReview={props.onSubmitReview}
        onSaveTasks={actions.saveTasks}
        onCopyLink={actions.copyLink}
        onRetry={actions.retry}
        onStop={actions.stop}
        onReReview={actions.reReview}
        onFork={actions.setForkSource}
        onTransfer={actions.setTransferSource}
      />
    </section>
  )
}

function ThreadRelatedMenu({ job }: { job: JobLog | null }) {
  if (!job) return null
  const pullRequestNumber = job.linked_pr_number ?? job.pr_number
  const workKey = job.work_item_id ? `W-${String(job.work_item_id).padStart(4, '0')}` : null
  if (!pullRequestNumber && !workKey && !job.source_job_id) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="absolute right-2 top-2" aria-label="Open related item">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Related items</DropdownMenuLabel>
        {pullRequestNumber ? (
          <DropdownMenuItem asChild>
            <a href={`/pull-requests/${job.repo_id}/${pullRequestNumber}`}>
              <GitPullRequest />
              Pull request #{pullRequestNumber}
            </a>
          </DropdownMenuItem>
        ) : null}
        {workKey ? (
          <DropdownMenuItem asChild>
            <a href={`/work/${workKey}`}>
              <BriefcaseBusiness />
              Work item {workKey}
            </a>
          </DropdownMenuItem>
        ) : null}
        {job.source_job_id ? (
          <DropdownMenuItem asChild>
            <a href={`/threads/${job.source_job_id}`}>
              <Network />
              Parent thread
            </a>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ThreadInputSection({ workspace }: { workspace: ThreadPanelWorkspace }) {
  const { data, actions, presentation, questions } = workspace
  if (!presentation.needsInput || !data.job) return null
  return (
    <div className="shrink-0 border-b border-primary/15 bg-primary/[.025] px-3 py-3 sm:px-5" aria-live="polite">
      <div className="mx-auto w-full max-w-[760px]">
        <ThreadInputRequestForm
          job={data.job}
          questions={questions}
          answers={actions.answers}
          custom={actions.custom}
          setAnswers={actions.setAnswers}
          setCustom={actions.setCustom}
          selections={actions.selections}
          setSelections={actions.setSelections}
          onSubmit={actions.submitAnswers}
          onCancel={questions.some((question) => question.formTitle) ? actions.cancelForm : undefined}
          className="m-0 max-h-[min(55dvh,38rem)] border-primary/25 bg-background/85 shadow-sm sm:m-0"
        />
      </div>
    </div>
  )
}

function ThreadTabsSection({
  jobId,
  activityOnly,
  workspace,
}: {
  jobId: number | null
  activityOnly: boolean
  workspace: ThreadPanelWorkspace
}) {
  const { data, actions, presentation } = workspace
  return (
    <ThreadPanelTabs
      jobId={jobId}
      job={data.job}
      loading={data.loading}
      activityOnly={activityOnly}
      activeTab={workspace.activeTab}
      reviewDefaultTab={presentation.reviewDefaultTab}
      isCodeReview={presentation.isCodeReview}
      reviewResult={presentation.reviewResult}
      suggestions={data.suggestions}
      postingSuggestions={actions.postingSuggestions}
      showFollowUpComposer={presentation.showFollowUpComposer}
      followUp={actions.followUp}
      composerFocusToken={actions.composerFocusToken}
      followUpOptions={actions.followUpOptions}
      sendingFollowUp={actions.sendingFollowUp}
      steeringQueuedId={actions.steeringQueuedId}
      cancellingQueuedId={actions.cancellingQueuedId}
      stopping={actions.stopping}
      diffLoading={data.diffLoading}
      diffError={data.diffError}
      diffPreview={data.diffPreview}
      setFileReference={workspace.setFileReference}
      onTabChange={(value) => {
        workspace.setActiveTab(value)
        workspace.setChangesActive(['changes', 'suggestions'].includes(value))
      }}
      onFollowUpChange={actions.setFollowUp}
      onFollowUpOptionsChange={actions.setFollowUpOptions}
      onSubmitFollowUp={actions.submitFollowUp}
      onSteerQueued={actions.steerQueuedFollowUp}
      onCancelQueued={actions.cancelQueuedFollowUp}
      onInterrupt={() => void actions.stop()}
      onChangeSuggestion={actions.changeSuggestion}
      onPostSuggestions={actions.postSuggestions}
      onRetryDiff={data.retryDiff}
      onAddCodeSelection={actions.addCodeSelectionToChat}
    />
  )
}

function ThreadPanelDialogs({ props, workspace }: { props: ThreadPanelProps; workspace: ThreadPanelWorkspace }) {
  const { actions } = workspace
  return (
    <>
      <SourceFileDialog workspace={workspace} />
      <ForkThreadDialog
        source={actions.forkSource}
        onOpenChange={(open) => !open && actions.setForkSource(null)}
        onForked={(forked) => {
          actions.setForkSource(null)
          props.onForked?.(forked)
        }}
      />
      <CrossWorktreeFollowUpDialog source={actions.transferSource} onOpenChange={(open) => !open && actions.setTransferSource(null)} />
    </>
  )
}

function SourceFileDialog({ workspace }: { workspace: ThreadPanelWorkspace }) {
  const { data, actions, presentation, fileReference, setFileReference } = workspace
  if (!data.job || !fileReference) return null
  return (
    <LazySourceFileDialog
      jobId={data.job.id}
      worktreePath={data.job.worktree_path}
      reference={fileReference}
      onOpenChange={(open) => !open && setFileReference(null)}
      onAddToChat={presentation.showFollowUpComposer ? actions.addCodeSelectionToChat : undefined}
    />
  )
}

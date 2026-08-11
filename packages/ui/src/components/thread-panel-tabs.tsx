import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertexade/ui/components/ui/tabs'
import { Conversation, ConversationContent, ConversationScrollButton } from '@vertexade/ui/components/ai-elements/conversation'
import type { PromptInputMessage } from '@vertexade/ui/components/ai-elements/prompt-input'
import type { FileReference } from '@vertexade/ui/components/markdown-content'
import { ThreadMarkdownContent } from '@vertexade/ui/components/thread-markdown-content'
import { FollowUpComposer, ThreadActivity } from '@vertexade/ui/components/thread-dialog-support'
import { ThreadChanges } from '@vertexade/ui/components/thread-changes'
import { ThreadReviewSuggestions, type ReviewSuggestion } from '@vertexade/ui/components/thread-review-suggestions'
import type { AgentLaunchOptions } from '@vertexade/ui/lib/dashboard-api'
import type { JobDiffPreview, JobLog } from '@vertexade/ui/lib/dashboard-types'
import type { ChatCodeSelection } from '@vertexade/ui/lib/code-selection'
import { cn } from '@vertexade/ui/lib/utils'

type ThreadPanelTabsProps = {
  jobId: number | null
  job: JobLog | null
  loading: boolean
  activityOnly: boolean
  activeTab: string | null
  reviewDefaultTab: string
  isCodeReview: boolean
  reviewResult: { summary: string; details: string } | null
  suggestions: ReviewSuggestion[]
  postingSuggestions: boolean
  showFollowUpComposer: boolean
  followUp: string
  composerFocusToken: number
  followUpOptions: AgentLaunchOptions
  sendingFollowUp: boolean
  steeringQueuedId: number | null
  cancellingQueuedId: number | null
  stopping: boolean
  diffLoading: boolean
  diffError: string
  diffPreview: JobDiffPreview | null
  setFileReference: Dispatch<SetStateAction<FileReference | null>>
  onTabChange(value: string): void
  onFollowUpChange(value: string): void
  onFollowUpOptionsChange(value: AgentLaunchOptions): void
  onSubmitFollowUp(message?: PromptInputMessage, event?: FormEvent<HTMLFormElement>): Promise<void>
  onSteerQueued(id: number): Promise<void>
  onCancelQueued(id: number): Promise<void>
  onInterrupt(): void
  onChangeSuggestion(id: number, patch: Partial<ReviewSuggestion>): void
  onPostSuggestions(): void
  onRetryDiff(): void
  onAddCodeSelection(selection: ChatCodeSelection): void
}

export function ThreadPanelTabs(props: ThreadPanelTabsProps) {
  return (
    <Tabs
      value={props.activityOnly ? 'activity' : props.activeTab || props.reviewDefaultTab}
      onValueChange={props.onTabChange}
      className="min-h-0 flex-1 gap-0 overflow-hidden"
    >
      <ThreadTabsNavigation
        job={props.job}
        activityOnly={props.activityOnly}
        isCodeReview={props.isCodeReview}
        suggestionCount={props.suggestions.length}
      />
      <ActivityTab {...props} />
      <SummaryTab {...props} />
      <FindingsTab {...props} />
      <SuggestionsTab {...props} />
      <ThreadChanges
        jobId={props.jobId}
        loading={props.diffLoading}
        error={props.diffError}
        preview={props.diffPreview}
        onRetry={props.onRetryDiff}
        onAddToChat={props.showFollowUpComposer ? props.onAddCodeSelection : undefined}
      />
    </Tabs>
  )
}

function ThreadTabsNavigation({
  job,
  activityOnly,
  isCodeReview,
  suggestionCount,
}: Pick<ThreadPanelTabsProps, 'job' | 'activityOnly' | 'isCodeReview'> & { suggestionCount: number }) {
  return (
    <div className={activityOnly ? 'hidden' : 'flex shrink-0 items-center gap-2 border-b px-2 py-1.5 sm:px-4 sm:py-2'}>
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabsList className="h-11 w-max px-1 sm:h-8 sm:px-[3px] [&_[data-slot=tabs-trigger]]:px-3 sm:[&_[data-slot=tabs-trigger]]:px-1.5">
          <SummaryTabTrigger visible={isCodeReview} />
          <FindingsTabTrigger job={job} />
          <SuggestionsTabTrigger job={job} count={suggestionCount} />
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="changes">Changes {diffCountLabel(job)}</TabsTrigger>
        </TabsList>
      </div>
      <DiffSummary job={job} />
    </div>
  )
}

function SummaryTabTrigger({ visible }: { visible: boolean }) {
  if (!visible) return null
  return <TabsTrigger value="summary">Summary</TabsTrigger>
}

function FindingsTabTrigger({ job }: Pick<ThreadPanelTabsProps, 'job'>) {
  if (!showsFindings(job)) return null
  return <TabsTrigger value="findings">{job?.kind === 'stack_analysis' ? 'Stack report' : 'Full review'}</TabsTrigger>
}

function SuggestionsTabTrigger({ job, count }: Pick<ThreadPanelTabsProps, 'job'> & { count: number }) {
  if (job?.kind !== 'review') return null
  return (
    <TabsTrigger value="suggestions" data-audit-action="thread.suggestions.open">
      Suggestions {count ? `(${count})` : ''}
    </TabsTrigger>
  )
}

function diffCountLabel(job: JobLog | null) {
  const count = job?.diff_summary.files.length ?? 0
  return count ? `(${count})` : ''
}

function DiffSummary({ job }: Pick<ThreadPanelTabsProps, 'job'>) {
  if (!job?.diff_summary.files.length) return null
  return (
    <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:block">
      <span className="text-emerald-400">+{job.diff_summary.additions}</span>{' '}
      <span className="text-red-400">−{job.diff_summary.deletions}</span>
    </span>
  )
}

function ActivityTab(props: ThreadPanelTabsProps) {
  return (
    <TabsContent value="activity" className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          className={cn('mx-auto w-full', props.activityOnly ? 'max-w-none gap-2 px-3 py-2' : 'max-w-5xl gap-4 px-3 py-4 sm:px-5 sm:py-5')}
        >
          <ThreadActivity
            job={props.job}
            loading={props.loading}
            onOpenFile={props.setFileReference}
            showWorkflowPlan={!props.activityOnly}
          />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <ActivityComposer {...props} />
    </TabsContent>
  )
}

type ActivityComposerProps = Pick<
  ThreadPanelTabsProps,
  | 'job'
  | 'activityOnly'
  | 'showFollowUpComposer'
  | 'followUp'
  | 'composerFocusToken'
  | 'followUpOptions'
  | 'sendingFollowUp'
  | 'steeringQueuedId'
  | 'cancellingQueuedId'
  | 'stopping'
  | 'onFollowUpChange'
  | 'onFollowUpOptionsChange'
  | 'onSubmitFollowUp'
  | 'onSteerQueued'
  | 'onCancelQueued'
  | 'onInterrupt'
>

function ActivityComposer(props: ActivityComposerProps) {
  if (!props.job || !props.showFollowUpComposer) return null
  return (
    <FollowUpComposer
      job={props.job}
      value={props.followUp}
      focusToken={props.composerFocusToken}
      options={props.followUpOptions}
      sending={props.sendingFollowUp}
      steeringQueuedId={props.steeringQueuedId}
      cancellingQueuedId={props.cancellingQueuedId}
      compact={props.activityOnly}
      onChange={props.onFollowUpChange}
      onOptionsChange={props.onFollowUpOptionsChange}
      onSubmit={props.onSubmitFollowUp}
      onSteerQueued={props.onSteerQueued}
      onCancelQueued={props.onCancelQueued}
      stopping={props.stopping}
      onInterrupt={props.onInterrupt}
    />
  )
}

type SummaryTabProps = Pick<ThreadPanelTabsProps, 'isCodeReview' | 'job' | 'reviewResult' | 'setFileReference'>

function SummaryTab(props: SummaryTabProps) {
  if (!props.isCodeReview || !props.job) return null
  return (
    <TabsContent value="summary" className="min-h-0 flex-1 overflow-auto p-2 sm:p-4">
      <div className="mx-auto max-w-3xl rounded-xl border bg-background p-3 shadow-xs sm:p-6">
        <ReviewSummaryHeader ephemeral={Boolean(props.job.ephemeral)} />
        <ReviewSummaryContent job={props.job} reviewResult={props.reviewResult} onOpenFile={props.setFileReference} />
      </div>
    </TabsContent>
  )
}

function ReviewSummaryHeader({ ephemeral }: { ephemeral: boolean }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <strong className="text-sm">Review summary</strong>
      <div className="flex gap-2">
        <Badge variant="outline" className="border-blue-500/40 text-blue-400">
          Private
        </Badge>
        {ephemeral ? (
          <Badge variant="outline" className="border-violet-500/40 text-violet-400">
            Ephemeral
          </Badge>
        ) : null}
      </div>
    </div>
  )
}

function ReviewSummaryContent({
  job,
  reviewResult,
  onOpenFile,
}: Pick<ThreadPanelTabsProps, 'reviewResult'> & { job: JobLog; onOpenFile: ThreadPanelTabsProps['setFileReference'] }) {
  if (reviewResult?.summary)
    return <ThreadMarkdownContent content={reviewResult.summary} onOpenFile={onOpenFile} worktreePath={job.worktree_path} />
  return <p className="py-12 text-center text-sm text-muted-foreground">{summaryWaitingMessage(job)}</p>
}

function summaryWaitingMessage(job: JobLog) {
  if (job.review_phase === 'summary_failed') return 'The summary failed, but the complete detailed review remains available.'
  if (job.review_phase === 'summary') return `${job.agent_name} is preparing the summary from the stored review.`
  return 'The detailed review and rating scorecard are prepared before the summary.'
}

function FindingsTab(props: ThreadPanelTabsProps) {
  if (!showsFindings(props.job)) return null
  return (
    <TabsContent value="findings" className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
      <div className="mx-auto max-w-4xl rounded-lg border bg-background p-3 sm:p-4">
        <FindingsHeader job={props.job} />
        <FindingsContent {...props} />
      </div>
    </TabsContent>
  )
}

function FindingsHeader({ job }: Pick<ThreadPanelTabsProps, 'job'>) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <strong className="font-mono text-xs">{findingsTitle(job?.kind)}</strong>
      <Badge variant="outline" className="shrink-0 border-blue-500/40 text-blue-400">
        Not posted
      </Badge>
    </div>
  )
}

function FindingsContent({ job, isCodeReview, reviewResult, setFileReference }: ThreadPanelTabsProps) {
  if (!job) return null
  if (isCodeReview && reviewResult?.details)
    return <ThreadMarkdownContent content={reviewResult.details} onOpenFile={setFileReference} worktreePath={job.worktree_path} />
  if (isCodeReview)
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {job.agent_name} is preparing the detailed review and rating scorecard first.
      </p>
    )
  if (job.result_text)
    return <ThreadMarkdownContent content={job.result_text} onOpenFile={setFileReference} worktreePath={job.worktree_path} />
  return <p className="py-12 text-center text-sm text-muted-foreground">{job.agent_name || 'The agent'} is still preparing the report.</p>
}

type SuggestionsTabProps = Pick<
  ThreadPanelTabsProps,
  | 'job'
  | 'suggestions'
  | 'postingSuggestions'
  | 'diffLoading'
  | 'diffError'
  | 'diffPreview'
  | 'onChangeSuggestion'
  | 'onPostSuggestions'
  | 'onRetryDiff'
>

function SuggestionsTab(props: SuggestionsTabProps) {
  if (props.job?.kind !== 'review') return null
  return (
    <TabsContent value="suggestions" className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
      <ThreadReviewSuggestions
        status={props.job.status}
        suggestions={props.suggestions}
        posting={props.postingSuggestions}
        loading={props.diffLoading}
        error={props.diffError}
        preview={props.diffPreview}
        onChange={props.onChangeSuggestion}
        onPost={() => void props.onPostSuggestions()}
        onRetry={props.onRetryDiff}
      />
    </TabsContent>
  )
}

function showsFindings(job: JobLog | null) {
  return ['review', 'work_review', 'stack_analysis'].includes(job?.kind || '')
}

function findingsTitle(kind: JobLog['kind'] | undefined) {
  if (kind === 'stack_analysis') return 'Private PR stack report'
  if (kind === 'work_review') return 'Complete private worktree review'
  return 'Complete private review'
}

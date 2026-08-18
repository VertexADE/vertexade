import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  Circle,
  CircleAlert,
  Clock3,
  CopyPlus,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Link2,
  ListPlus,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  RotateCcw,
  Send,
  Sparkles,
  Server,
  Terminal,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { DiffReview } from '@vertexade/ui/components/diff-review'
import { ForkThreadDialog } from '@vertexade/ui/components/fork-thread-dialog'
import { CrossWorktreeFollowUpDialog } from '@vertexade/ui/components/cross-worktree-follow-up-dialog'
import { AgentActivityTimeline } from '@vertexade/ui/components/agent-activity-timeline'
import { AgentAvatar, AgentContextBadges } from '@vertexade/ui/components/agent-identity'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'
import type { FileReference } from '@vertexade/ui/components/markdown-content'
import { SourceFileDialog } from '@vertexade/ui/components/source-file-dialog'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@vertexade/ui/components/ai-elements/conversation'
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from '@vertexade/ui/components/ai-elements/plan'
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from '@vertexade/ui/components/ai-elements/prompt-input'
import { PromptInputAttachImage, PromptInputImagePreview, PromptInputImageSubmit } from '@vertexade/ui/components/prompt-images'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button, buttonVariants } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { StopAction } from '@vertexade/ui/components/thread-panel-actions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Progress } from '@vertexade/ui/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@vertexade/ui/components/ui/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertexade/ui/components/ui/tabs'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import {
  age,
  api,
  duration,
  isThreadEvent,
  parseJson,
  subscribeToDashboardEvents,
  type AgentLaunchOptions,
} from '@vertexade/ui/lib/dashboard-api'
import type { InputQuestion, Job, JobDiffPreview, JobLog } from '@vertexade/ui/lib/dashboard-types'
import { agentIsWorking, agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { threadActivityEvents } from '@vertexade/ui/lib/thread-activity'
import { threadOutcome, type ThreadOutcome } from '@vertexade/ui/lib/thread-outcome'
import { followUpDelivery } from '@vertexade/ui/lib/follow-up-delivery'
import { embedPromptImages, PROMPT_IMAGE_ACCEPT, PROMPT_IMAGE_MAX_BYTES, PROMPT_IMAGE_MAX_FILES } from '@vertexade/ui/lib/prompt-images'
import { BackendBadge } from '@vertexade/ui/components/backend-badge'
import { cn } from '@vertexade/ui/lib/utils'
import { storedReviewResult } from '@vertexade/ui/lib/review-summary'
import { threadTitle } from '@vertexade/ui/lib/thread-title'
import { buildAgentTimeline, timelinePlan } from '@vertexade/ui/lib/agent-timeline'
import { displayBackendId, localBackendId } from '@vertexade/ui/lib/backend-registry'

export const threadHeaderClass =
  'mx-0 mt-0 shrink-0 border-b bg-gradient-to-br from-primary/[.09] via-background to-background px-3 py-2 sm:px-4 sm:py-2.5'

const kindName: Record<string, string> = {
  task: 'Task',
  review: 'Code review',
  review_handoff: 'Review follow-up',
  pre_pr: 'Implementation',
  work_review: 'Worktree review',
  stack_analysis: 'Stack analysis',
  planning: 'Planning',
  subagent: 'Child agent',
}

export function ThreadDialogHeader({
  job,
  outcome,
  needsInput,
}: {
  job: JobLog | null
  outcome: ThreadOutcome | null
  needsInput: boolean
}) {
  if (!job || !outcome)
    return (
      <div>
        <h2 className="text-lg font-semibold leading-none tracking-tight">Agent run</h2>
        <p className="mt-1 text-sm text-muted-foreground">Loading run details…</p>
      </div>
    )
  const title = threadTitle(job)
  const pullRequest = runPullRequest(job)
  const state = agentThreadState(job)
  const elapsedStart = agentIsWorking(state) ? job.turn_started_at || job.created_at : job.created_at
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2.5">
        <AgentAvatar id={job.agent_id} name={job.agent_name} accent={job.agent_accent} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="font-mono text-xs">
              Run #{displayBackendId(job, job.id)}
            </Badge>
            <Badge variant="outline" className="hidden text-xs sm:inline-flex">
              {job.agent_name}
            </Badge>
            <BackendBadge source={job} nameOnly />
            <Badge variant="outline" className="hidden text-xs sm:inline-flex">
              {job.kind_label || kindName[job.kind] || job.kind.replaceAll('_', ' ')}
            </Badge>
            {job.kind === 'subagent' && job.source_job_id && (
              <Badge variant="outline" className="text-xs">
                Parent #{localBackendId(job.source_job_id)}
              </Badge>
            )}
            {job.subagent_integrated_at && (
              <Badge variant="outline" className="border-emerald-500/40 text-xs text-emerald-400">
                Integrated
              </Badge>
            )}
            <ThreadStatusBadges job={job} outcome={outcome} needsInput={needsInput} />
          </div>
          <h2 className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight sm:text-base">{title}</h2>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="min-w-0 truncate text-xs text-muted-foreground">{job.full_name}</p>
            <AgentContextBadges model={job.agent_model} reasoningEffort={job.agent_reasoning_effort} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
        <ThreadMeta icon={GitBranch} label="Branch" value={job.branch_name || 'No branch'} />
        <ThreadMeta icon={GitPullRequest} label="Pull request" value={pullRequest.label} href={pullRequest.url} />
        <ThreadMeta icon={Clock3} label="Elapsed" value={duration(elapsedStart, job.finished_at)} />
        <ThreadMeta icon={FolderGit2} label="Workspace" value={workspaceName(job)} title={workspaceTitle(job)} />
      </div>
    </div>
  )
}

export function ThreadCompactHeader({
  job,
  outcome,
  needsInput,
}: {
  job: JobLog | null
  outcome: ThreadOutcome | null
  needsInput: boolean
}) {
  if (!job || !outcome)
    return (
      <div className="min-w-0">
        <strong className="block text-sm">Agent run</strong>
        <span className="text-xs text-muted-foreground">Loading session context…</span>
      </div>
    )

  return (
    <div className="flex min-w-0 items-start gap-2">
      <AgentAvatar id={job.agent_id} name={job.agent_name} accent={job.agent_accent} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="min-w-0 max-w-full truncate text-sm font-semibold tracking-tight">{threadTitle(job)}</h2>
          <span className="flex shrink-0 flex-wrap items-center gap-1">
            <ThreadStatusBadges job={job} outcome={outcome} needsInput={needsInput} />
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="font-mono">Run #{displayBackendId(job, job.id)}</span>
          <BackendBadge source={job} nameOnly />
          <span aria-hidden="true">·</span>
          <span className="max-w-56 truncate">{job.full_name}</span>
          {job.branch_name ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                <GitBranch className="size-3 shrink-0" />
                <span className="max-w-48 truncate">{job.branch_name}</span>
              </span>
            </>
          ) : null}
          <AgentContextBadges model={job.agent_model} reasoningEffort={job.agent_reasoning_effort} />
        </div>
      </div>
    </div>
  )
}

function workspaceName(job: JobLog) {
  if (job.workspace_mode === 'combined' && job.session_cwd) {
    return `${job.session_cwd.split('/').filter(Boolean).at(-1) || 'Work'} · combined`
  }
  const directory = job.worktree_path.split('/').filter(Boolean).at(-1)
  return directory || job.full_name.split('/').at(-1) || 'Agent worktree'
}

function workspaceTitle(job: JobLog) {
  return job.workspace_mode === 'combined' && job.session_cwd
    ? `${job.session_cwd}\nAssigned repository: ${job.worktree_path}`
    : job.worktree_path
}

function runPullRequestNumber(job: JobLog) {
  return job.linked_pr_number ?? job.pr_number
}

function emptyPullRequestLabel(job: JobLog) {
  return job.kind === 'work_review' ? 'Not applicable' : 'Awaiting PR'
}

function runPullRequest(job: JobLog) {
  const number = runPullRequestNumber(job)
  if (number) return { label: `PR #${number}`, url: job.linked_pr_url || undefined }
  return { label: emptyPullRequestLabel(job), url: undefined }
}

type StatusBadge = { label: string; className: string; icon?: 'check' | 'loading' }

const inputBadge: StatusBadge[] = [{ label: 'Input required', className: 'border-amber-500/40 text-amber-400' }]
const outputBadge: StatusBadge = {
  label: 'Done',
  className: 'border-emerald-500/40 bg-emerald-500/[.06] text-emerald-400',
  icon: 'check',
}
const outputBadges: Record<ThreadOutcome['followUp'], StatusBadge[]> = {
  none: [outputBadge],
  failed: [{ label: 'Follow-up failed', className: 'border-red-500/40 bg-red-500/[.06] text-red-400' }],
  running: [
    {
      label: 'Follow-up running',
      className: 'border-blue-500/40 bg-blue-500/[.06] text-blue-400',
      icon: 'loading',
    },
  ],
  waiting: [{ label: 'Input required', className: 'border-amber-500/40 bg-amber-500/[.06] text-amber-400' }],
  paused: [
    {
      label: 'Follow-up paused',
      className: 'border-amber-500/40 bg-amber-500/[.06] text-amber-400',
    },
  ],
  completed: [outputBadge],
}
const statusBadges: Record<string, StatusBadge[]> = {
  failed: [{ label: 'Failed', className: 'border-red-500/40 text-red-400' }],
  starting: [{ label: 'Starting', className: 'border-blue-500/40 text-blue-400' }],
  running: [{ label: 'Running', className: 'border-blue-500/40 text-blue-400' }],
  completed: [{ label: 'Completed', className: 'border-emerald-500/40 text-emerald-400' }],
  resumable: [{ label: 'Ready to resume', className: 'border-amber-500/40 text-amber-400' }],
  interrupted: [{ label: 'Interrupted', className: 'border-amber-500/40 text-amber-400' }],
  cancelled: [{ label: 'Stopped', className: 'border-amber-500/40 text-amber-400' }],
}

function badgeData(job: JobLog, outcome: ThreadOutcome, needsInput: boolean): StatusBadge[] {
  if (needsInput) return inputBadge
  if (outcome.outputReady) return outputBadges[outcome.followUp]
  return statusBadges[job.status]
}

function ThreadStatusBadges({ job, outcome, needsInput }: { job: JobLog; outcome: ThreadOutcome; needsInput: boolean }) {
  return (
    <>
      {badgeData(job, outcome, needsInput).map((badge) => (
        <Badge key={badge.label} variant="outline" className={cn('h-5 px-1.5 text-[11px]', badge.className)}>
          {badge.icon === 'check' && <CheckCircle2 />}
          {badge.icon === 'loading' && <Loader2 className="animate-spin" />}
          {badge.label}
        </Badge>
      ))}
    </>
  )
}

function ThreadMeta({
  icon: Icon,
  label,
  value,
  href,
  title,
}: {
  icon: typeof GitBranch
  label: string
  value: string
  href?: string
  title?: string
}) {
  const content = <span className="truncate text-xs font-medium text-foreground">{value}</span>
  return (
    <div className="grid min-w-0 grid-cols-[auto_1fr] gap-x-1.5 rounded-md border bg-background/70 px-2 py-1" title={title}>
      <Icon className="row-span-2 mt-0.5 size-3.5 text-muted-foreground" />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {href ? (
        <a href={href} className="flex min-w-0 items-center gap-1 text-blue-400 hover:underline">
          {content}
          <ExternalLink className="size-3 shrink-0" />
        </a>
      ) : (
        content
      )}
    </div>
  )
}

export function ThreadOutcomeBanner({ outcome }: { outcome: ThreadOutcome }) {
  const styles = {
    success: 'border-emerald-500/20 bg-emerald-500/[.05] text-emerald-400',
    warning: 'border-amber-500/20 bg-amber-500/[.05] text-amber-400',
    danger: 'border-red-500/20 bg-red-500/[.05] text-red-400',
    active: 'border-blue-500/20 bg-blue-500/[.05] text-blue-400',
    neutral: '',
  }
  const icons = {
    success: CheckCircle2,
    warning: CircleAlert,
    danger: CircleAlert,
    active: Loader2,
    neutral: Circle,
  }
  const Icon = icons[outcome.tone]
  return (
    <div className={cn('flex shrink-0 items-start gap-2.5 border-b px-3 py-2 text-xs sm:px-5 sm:py-2.5', styles[outcome.tone])}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', outcome.tone === 'active' && 'animate-spin')} />
      <div className="min-w-0">
        <strong className="block text-foreground">{outcome.headline}</strong>
        <span className="line-clamp-2 text-xs text-muted-foreground sm:line-clamp-none">{outcome.description}</span>
      </div>
    </div>
  )
}

export function FollowUpComposer({
  job,
  value,
  focusToken,
  options,
  sending,
  steeringQueuedId,
  cancellingQueuedId,
  compact = false,
  onChange,
  onOptionsChange,
  onSubmit,
  onSteerQueued,
  onCancelQueued,
  stopping,
  onInterrupt,
}: {
  job: JobLog
  value: string
  focusToken: number
  options: AgentLaunchOptions
  sending: boolean
  steeringQueuedId: number | null
  cancellingQueuedId: number | null
  compact?: boolean
  onChange: (value: string) => void
  onOptionsChange: (value: AgentLaunchOptions) => void
  onSubmit: (message?: PromptInputMessage, event?: React.FormEvent<HTMLFormElement>) => Promise<void>
  onSteerQueued: (id: number) => Promise<void>
  onCancelQueued: (id: number) => Promise<void>
  stopping: boolean
  onInterrupt: () => void
}) {
  const view = followUpView(job)
  const queued = job.queued_follow_ups || []
  const hasPrompt = Boolean(value.trim())
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!focusToken) return
    requestAnimationFrame(() => {
      const input = textarea.current
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })
  }, [focusToken])

  return (
    <div
      className={cn(
        'shrink-0 border-t bg-background/95 shadow-[0_-8px_24px_-20px_rgba(0,0,0,.8)]',
        compact ? 'p-2 sm:px-3' : 'p-2 sm:px-5 sm:py-3',
      )}
    >
      <div className={cn('mx-auto w-full max-w-[760px] border bg-card/60', compact ? 'rounded-lg p-1.5' : 'rounded-xl p-2 sm:p-2.5')}>
        <div className={cn('flex flex-wrap items-center justify-between gap-2 px-1', compact ? 'mb-1' : 'mb-2')}>
          <div>
            <strong className="text-xs">{compact ? 'Continue' : view.title}</strong>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="h-7 max-w-48 gap-1 truncate px-2 text-[11px]" title={job.backend_name || 'Local'}>
              <Server className="size-3.5 shrink-0" />
              <span className="truncate">{job.backend_name || 'Local'}</span>
            </Badge>
            {view.active ? (
              <Badge variant="outline" className="border-blue-500/40 text-xs text-blue-400">
                Live turn
              </Badge>
            ) : null}
            <AgentOptionsPicker compact lockedAgentId={job.agent_id} value={options} onChange={onOptionsChange} />
          </div>
        </div>
        {queued.length > 0 && (
          <QueuedFollowUps
            job={job}
            queued={queued}
            canSteer={view.steering}
            steeringId={steeringQueuedId}
            cancellingId={cancellingQueuedId}
            onSteer={onSteerQueued}
            onCancel={onCancelQueued}
          />
        )}
        <PromptInput
          accept={PROMPT_IMAGE_ACCEPT}
          multiple
          maxFiles={PROMPT_IMAGE_MAX_FILES}
          maxFileSize={PROMPT_IMAGE_MAX_BYTES}
          onError={(error) => toast.error(error.message)}
          onSubmit={onSubmit}
        >
          <PromptInputImagePreview />
          <PromptInputBody>
            <PromptInputTextarea
              ref={textarea}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              className={cn(compact ? 'min-h-8 max-h-20' : 'min-h-10 max-h-28')}
              placeholder={view.placeholder}
              aria-label={view.active ? 'Run direction message' : 'Follow-up message'}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputAttachImage />
              <span className="hidden px-1 text-xs text-muted-foreground sm:inline">
                Paste images · {view.active ? 'Enter queues' : 'Enter sends'} · Shift+Enter for a new line
              </span>
            </PromptInputTools>
            <div className="ml-auto flex items-center justify-end gap-1.5">
              {view.active && <StopAction stopping={stopping} onStop={onInterrupt} />}
              {hasPrompt && (
                <>
                  {view.steering && (
                    <PromptInputImageSubmit text={value} sending={sending} name="delivery" value="steer" size="sm" variant="outline">
                      <Send /> Steer now
                    </PromptInputImageSubmit>
                  )}
                  {view.active && (
                    <PromptInputImageSubmit text={value} sending={sending} name="delivery" value="queue" size="sm">
                      <ListPlus /> Queue
                    </PromptInputImageSubmit>
                  )}
                </>
              )}
              {!view.active && <PromptInputImageSubmit text={value} sending={sending} />}
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}

function QueuedFollowUps({
  job,
  queued,
  canSteer,
  steeringId,
  cancellingId,
  onSteer,
  onCancel,
}: {
  job: JobLog
  queued: JobLog['queued_follow_ups']
  canSteer: boolean
  steeringId: number | null
  cancellingId: number | null
  onSteer: (id: number) => Promise<void>
  onCancel: (id: number) => Promise<void>
}) {
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-amber-500/25 bg-amber-500/[.05]">
      <div className="flex items-center gap-2 border-b border-amber-500/15 px-2.5 py-1.5 text-xs text-amber-300">
        <ListPlus className="size-3.5" />
        <strong>{queued.length} queued for next turn</strong>
        <span className="ml-auto text-muted-foreground">Delivered in order</span>
      </div>
      <div className="max-h-36 divide-y divide-amber-500/10 overflow-y-auto">
        {queued.map((item, index) => (
          <div key={item.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-2">
            <Badge variant="outline" className="size-5 justify-center border-amber-500/25 p-0 text-xs text-amber-300">
              {index + 1}
            </Badge>
            <div className="min-w-0">
              <p className="line-clamp-2 text-xs leading-snug">{item.prompt}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {queuedFollowUpModelLabel(job, item)} · {age(item.queued_at)}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {canSteer && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={steeringId !== null || cancellingId !== null}
                  onClick={() => void onSteer(item.id)}
                >
                  {steeringId === item.id ? <Loader2 className="animate-spin" /> : <Send />}
                  <span className="hidden sm:inline">Use as steer</span>
                  <span className="sm:hidden">Steer</span>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Remove queued message"
                disabled={steeringId !== null || cancellingId !== null}
                onClick={() => void onCancel(item.id)}
              >
                {cancellingId === item.id ? <Loader2 className="animate-spin" /> : <X />}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function followUpView(job: JobLog) {
  const active = ['starting', 'running'].includes(job.status)
  const steering = job.can_steer && active
  return {
    active,
    steering,
    title: active ? 'Guide this work run' : 'Continue this task',
    placeholder: active ? `Add the next instruction to the queue…` : `Ask ${job.agent_name} to clarify, revise, or continue…`,
  }
}

function queuedFollowUpModelLabel(job: JobLog, queued: JobLog['queued_follow_ups'][number]) {
  return threadContextLabel(queued.model ?? job.agent_model, queued.reasoning_effort, `${job.agent_name} default`)
}

function threadContextLabel(model: string | null | undefined, reasoningEffort: string | null | undefined, fallback: string) {
  const values = [model, reasoningEffort].filter((value): value is string => Boolean(value))
  return values.join(' · ') || fallback
}

export function ThreadActivity({
  job,
  loading,
  onOpenFile,
  showWorkflowPlan = true,
}: {
  job: JobLog | null
  loading: boolean
  onOpenFile: (reference: FileReference) => void
  showWorkflowPlan?: boolean
}) {
  if (loading && !job)
    return (
      <ConversationEmptyState
        icon={<Bot className="size-6" />}
        title="Loading the run"
        description="Fetching agent activity and changes…"
      />
    )
  if (!job)
    return <ConversationEmptyState icon={<Bot className="size-6" />} title="Run unavailable" description="This run could not be loaded." />

  return (
    <>
      {showWorkflowPlan && <ThreadWorkflowPlan job={job} />}
      <AgentActivityTimeline
        events={threadActivityEvents(job)}
        content={job.content}
        state={agentThreadState(job)}
        agent={{
          id: job.agent_id,
          name: job.agent_name,
          accent: job.agent_accent,
          model: job.agent_model,
          reasoningEffort: job.agent_reasoning_effort,
        }}
        onOpenFile={onOpenFile}
        worktreePath={job.worktree_path}
      />
    </>
  )
}

type ProgressStage = {
  label: string
  complete: boolean
  active: boolean
  waiting?: boolean
  error?: boolean
}

function ThreadWorkflowPlan({ job }: { job: JobLog }) {
  const outcome = threadOutcome(job)
  const state = agentThreadState(job)
  const running = agentIsWorking(state)
  const waiting = state === 'waiting'
  const reportedPlan = timelinePlan(buildAgentTimeline(threadActivityEvents(job), state))
  const stages = reportedPlan.steps.length
    ? reportedPlan.steps.map(
        (step): ProgressStage => ({
          label: step.label,
          complete: step.status === 'completed',
          active: step.status === 'running',
        }),
      )
    : lifecycleProgressStages(job, outcome, running, waiting)
  const progress = reportedPlan.progress ?? Math.round((stages.filter((stage) => stage.complete).length / Math.max(stages.length, 1)) * 100)

  return (
    <Plan
      defaultOpen={running || waiting}
      isStreaming={running}
      className="border-blue-500/20 bg-gradient-to-br from-blue-500/[.07] via-card to-card shadow-sm"
    >
      <PlanHeader>
        <div className="min-w-0">
          <PlanTitle>{outcome.headline}</PlanTitle>
          <PlanDescription>{outcome.description}</PlanDescription>
        </div>
        <PlanAction>
          <PlanTrigger />
        </PlanAction>
      </PlanHeader>
      <PlanContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{reportedPlan.steps.length ? 'Agent plan' : 'Run lifecycle'}</span>
            <span>
              {stages.filter((stage) => stage.complete).length}/{stages.length} complete
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {stages.map((stage) => (
            <ProgressStageRow key={stage.label} stage={stage} />
          ))}
        </div>
      </PlanContent>
    </Plan>
  )
}

function lifecycleProgressStages(job: JobLog, outcome: ReturnType<typeof threadOutcome>, running: boolean, waiting: boolean) {
  return [
    { label: 'Isolated worktree prepared', complete: true, active: false },
    taskOutputStage(job, outcome, running, waiting),
    changedFilesStage(job, outcome.outputReady),
    followUpStage(outcome.followUp),
    reviewSummaryStage(job, running),
  ].filter((stage): stage is ProgressStage => stage !== null)
}

function taskOutputStage(job: JobLog, outcome: ReturnType<typeof threadOutcome>, running: boolean, waiting: boolean): ProgressStage {
  let label = 'Task output produced'
  if (waiting && !outcome.outputReady) label = 'Task waiting for input'
  else if (job.kind === 'review') label = 'Repository and pull request reviewed'
  else if (job.kind === 'work_review') label = 'Work item implementation snapshot reviewed'
  return {
    label,
    complete: outcome.outputReady,
    active: running && !outcome.outputReady,
    waiting: waiting && !outcome.outputReady,
  }
}

function changedFilesStage(job: JobLog, complete: boolean): ProgressStage {
  const files = job.diff_summary.files.length
  return {
    label: files ? `${files} changed ${files === 1 ? 'file' : 'files'} captured` : 'Working tree inspected',
    complete,
    active: false,
  }
}

function followUpStage(followUp: ReturnType<typeof threadOutcome>['followUp']): ProgressStage | null {
  if (followUp === 'none') return null
  const label =
    followUp === 'waiting' ? 'Follow-up waiting for input' : followUp === 'paused' ? 'Follow-up paused' : 'Latest follow-up applied'
  return {
    label,
    complete: followUp === 'completed',
    active: followUp === 'running',
    waiting: ['waiting', 'paused'].includes(followUp),
    error: followUp === 'failed',
  }
}

function reviewSummaryStage(job: JobLog, running: boolean): ProgressStage | null {
  if (!['review', 'work_review'].includes(job.kind)) return null
  return {
    label: 'Concise review summary prepared',
    complete: Boolean(job.review_summary) || job.review_phase === 'complete',
    active: running && job.review_phase === 'summary',
  }
}

function ProgressStageRow({ stage }: { stage: ProgressStage }) {
  return (
    <div className={progressStageRowClass(stage)}>
      <span className={progressStageIconClass(stage)}>
        <ProgressStageIcon stage={stage} />
      </span>
      <span className={progressStageLabelClass(stage)}>{stage.label}</span>
    </div>
  )
}

function progressStageRowClass(stage: ProgressStage) {
  return cn(
    'flex items-center gap-2 rounded-lg border bg-background/70 px-3 py-2 text-xs',
    stage.error && 'border-red-500/30 bg-red-500/[.04]',
    stage.waiting && 'border-amber-500/30 bg-amber-500/[.04]',
  )
}

function progressStageIconClass(stage: ProgressStage) {
  return cn(
    'grid size-5 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground',
    stage.complete && 'bg-emerald-500/15 text-emerald-500',
    stage.active && 'bg-blue-500/15 text-blue-500',
    stage.waiting && 'bg-amber-500/15 text-amber-500',
    stage.error && 'bg-red-500/15 text-red-500',
  )
}

function progressStageLabelClass(stage: ProgressStage) {
  return cn('text-muted-foreground', highlightedProgressStage(stage) && 'text-foreground')
}

function highlightedProgressStage(stage: ProgressStage) {
  return stage.complete || stage.active || stage.waiting || stage.error
}

function ProgressStageIcon({ stage }: { stage: ProgressStage }) {
  if (stage.complete) return <CheckCircle2 className="size-3.5" />
  if (stage.active) return <Loader2 className="size-3.5 animate-spin" />
  if (stage.waiting || stage.error) return <CircleAlert className="size-3.5" />
  return <Circle className="size-3" />
}

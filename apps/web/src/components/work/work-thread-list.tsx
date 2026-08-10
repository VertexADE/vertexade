import { ArrowRightLeft, Bot, FileSearch, GitBranch, GitPullRequest } from 'lucide-react'
import { AgentAvatar, agentDisplayName } from '@vertexade/ui/components/agent-identity'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { activityPreview } from '@vertexade/ui/lib/activity-preview'
import { agentIsWorking, agentThreadLabel, agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { splitWorkThreads, workThreadAction, workThreadCategory } from '@vertexade/ui/lib/work-thread'

function ThreadTypeBadge({ job }: { job: WorkItem['threads'][number] }) {
  const review = workThreadCategory(job) === 'review'
  return (
    <Badge
      variant="outline"
      className={cn(
        'w-fit gap-1 text-[11px]',
        review ? 'border-cyan-500/30 bg-cyan-500/[.06] text-cyan-300' : 'border-blue-500/30 bg-blue-500/[.06] text-blue-300',
      )}
    >
      {review ? <FileSearch className="size-2.5" /> : <Bot className="size-2.5" />}
      {review ? 'Review thread' : 'Work thread'}
    </Badge>
  )
}

function ThreadRow({ job, onOpen, review }: { job: WorkItem['threads'][number]; onOpen: (jobId: number) => void; review: boolean }) {
  const state = agentThreadState(job)
  const agentName = agentDisplayName(job.agent_id)
  const action = review ? reviewThreadAction(state) : workThreadAction(job)
  return (
    <button
      type="button"
      onClick={() => onOpen(job.id)}
      className={cn(
        'grid min-h-20 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-lg border bg-background p-3 text-left transition hover:bg-accent sm:min-h-0 sm:items-center',
        review ? 'hover:border-cyan-500/35' : 'hover:border-blue-500/35',
      )}
    >
      <span className="relative">
        <AgentAvatar id={job.agent_id} name={agentName} size="sm" />
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-background',
            agentIsWorking(state)
              ? 'bg-blue-400'
              : state === 'waiting' || state === 'resumable'
                ? 'bg-amber-400'
                : state === 'completed'
                  ? 'bg-emerald-400'
                  : state === 'failed'
                    ? 'bg-red-400'
                    : 'bg-slate-400',
          )}
        />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <strong className="truncate text-xs">{review ? reviewThreadTitle(job) : job.full_name}</strong>
          <ThreadTypeBadge job={job} />
        </div>
        {review ? <ReviewThreadMetadata job={job} /> : <WorkThreadMetadata job={job} />}
      </div>
      <div className="flex flex-col items-end gap-1">
        <Badge variant="outline" className={review ? 'border-cyan-500/25 text-cyan-300' : undefined}>
          {review ? reviewThreadStatus(state) : agentThreadLabel(state)}
        </Badge>
        <span className={cn('whitespace-nowrap text-[11px] font-medium', review ? 'text-cyan-300' : 'text-blue-400')}>
          {action} · #{job.id}
        </span>
      </div>
    </button>
  )
}

function WorkThreadMetadata({ job }: { job: WorkItem['threads'][number] }) {
  const changes = Number(job.diff_additions || 0) + Number(job.diff_deletions || 0)
  return (
    <div className="mt-1 space-y-1 text-[11px] text-muted-foreground">
      <span className="block line-clamp-2 leading-relaxed sm:truncate">
        {activityPreview(job.latest_activity || `${job.agent_id} · ${job.kind}`)}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 items-center gap-1 truncate font-mono">
          <GitBranch className="size-2.5 shrink-0" />
          {job.branch_name || 'Workspace branch pending'}
        </span>
        {changes > 0 && (
          <span className="shrink-0 font-mono">
            <span className="text-emerald-400">+{job.diff_additions || 0}</span>{' '}
            <span className="text-red-400">−{job.diff_deletions || 0}</span>
          </span>
        )}
      </span>
    </div>
  )
}

function ReviewThreadMetadata({ job }: { job: WorkItem['threads'][number] }) {
  return (
    <div className="mt-1 space-y-1 text-[11px] text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1">
        {job.pr_number ? <GitPullRequest className="size-2.5 shrink-0" /> : <FileSearch className="size-2.5 shrink-0" />}
        <span className="truncate">
          {job.pr_number ? `${job.full_name} · PR #${job.pr_number}` : `${job.full_name} · shared worktree review`}
        </span>
      </span>
      <span className="block line-clamp-2 leading-relaxed sm:truncate">
        {activityPreview(job.latest_activity || 'Review scope is ready to inspect.')}
      </span>
    </div>
  )
}

function reviewThreadTitle(job: WorkItem['threads'][number]) {
  return job.task_title || (job.pr_number ? `Review PR #${job.pr_number}` : 'Review shared implementation')
}

function reviewThreadStatus(state: ReturnType<typeof agentThreadState>) {
  if (state === 'completed') return 'Findings ready'
  if (state === 'failed') return 'Review failed'
  if (state === 'waiting' || state === 'resumable') return 'Review paused'
  if (agentIsWorking(state)) return 'Reviewing'
  return 'Review queued'
}

function reviewThreadAction(state: ReturnType<typeof agentThreadState>) {
  if (state === 'completed') return 'Open findings'
  if (state === 'failed') return 'Inspect failure'
  if (state === 'waiting' || state === 'resumable') return 'Resume review'
  return 'Inspect review'
}

function ThreadSection({
  title,
  description,
  threads,
  onOpen,
  review,
}: {
  title: string
  description: string
  threads: WorkItem['threads']
  onOpen: (jobId: number) => void
  review: boolean
}) {
  const Icon = review ? FileSearch : Bot
  return (
    <section
      className={cn('rounded-xl border p-3', review ? 'border-cyan-500/20 bg-cyan-500/[.025]' : 'border-blue-500/20 bg-blue-500/[.025]')}
    >
      <header className="mb-2 flex items-start gap-2">
        <Icon className={cn('mt-0.5 size-4 shrink-0', review ? 'text-cyan-400' : 'text-blue-400')} />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold">
            {title}{' '}
            <Badge variant="secondary" className="ml-1">
              {threads.length}
            </Badge>
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="space-y-2">
        {threads.map((thread) => (
          <ThreadRow key={thread.id} job={thread} onOpen={onOpen} review={review} />
        ))}
        {!threads.length && (
          <p className="rounded-lg border border-dashed bg-background/50 px-3 py-5 text-center text-[11px] text-muted-foreground">
            No {review ? 'review' : 'work'} thread yet.
          </p>
        )}
      </div>
    </section>
  )
}

export function ThreadList({
  item,
  onOpen,
  onStartWork,
  onStartReview,
}: {
  item: WorkItem
  onOpen: (jobId: number) => void
  onStartWork: () => void
  onStartReview: () => void
}) {
  const threads = splitWorkThreads(item.threads)
  const handedOff = item.context_transfers.length > 0
  return (
    <Card id="threads" className="scroll-mt-32">
      <CardHeader className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-blue-400" />
            Threads <Badge variant="secondary">{item.threads.length}</Badge>
          </CardTitle>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Work threads sequentially reuse their repository worktree. Review threads inspect that shared worktree read-only and keep
            findings separate.
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          {item.kind !== 'pr_review' && (
            <Button data-audit-action="work.thread.new-review" className="h-11 sm:h-8" variant="outline" size="sm" onClick={onStartReview}>
              <FileSearch />
              New review
            </Button>
          )}
          <Button
            data-audit-action={item.kind === 'pr_review' ? 'work.thread.new-review' : 'work.thread.new-agent'}
            className={cn('h-11 sm:h-8', item.kind === 'pr_review' && 'col-span-2')}
            size="sm"
            disabled={handedOff}
            onClick={onStartWork}
          >
            {item.kind === 'pr_review' ? <FileSearch /> : <Bot />}
            {item.kind === 'pr_review' ? 'New review thread' : 'New agent thread'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 xl:grid-cols-2">
        <ThreadSection
          title="Work threads"
          description="Implementation, investigation, planning, and follow-up work reuse this Work item's repository worktree."
          threads={threads.work}
          onOpen={onOpen}
          review={false}
        />
        <ThreadSection
          title="Review threads"
          description="Private read-only review of the current shared repository worktree."
          threads={threads.review}
          onOpen={onOpen}
          review
        />
      </CardContent>
      {handedOff && (
        <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">
          <ArrowRightLeft className="mr-1 inline size-3" />
          This item handed execution to another Work item, so new work starts on the destination thread.
        </div>
      )}
    </Card>
  )
}

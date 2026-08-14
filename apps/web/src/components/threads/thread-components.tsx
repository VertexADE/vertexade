import {
  Archive,
  ArchiveRestore,
  Clock3,
  CopyPlus,
  ExternalLink,
  FileText,
  FolderGit2,
  FolderInput,
  GitCommitHorizontal,
  MessageSquareText,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { AgentAvatar, AgentContextBadges } from '@vertexade/ui/components/agent-identity'
import { BackendBadge } from '@vertexade/ui/components/backend-badge'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button, buttonVariants } from '@vertexade/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { activityPreview } from '@vertexade/ui/lib/activity-preview'
import { agentIsWorking, agentThreadLabel, agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { age, api, duration, parseJson } from '@vertexade/ui/lib/dashboard-api'
import type { Job } from '@vertexade/ui/lib/dashboard-types'
import { displayBackendId, localBackendId } from '@vertexade/ui/lib/backend-registry'
import { threadPriority, type ThreadSort } from '@vertexade/ui/lib/thread-priority'
import { cn } from '@vertexade/ui/lib/utils'

export type StatusFilter = 'all' | 'attention' | 'active' | 'input' | 'action' | 'queued' | 'completed' | 'failed' | 'resumable'

export function matchesStatus(thread: Job, filter: StatusFilter) {
  if (filter === 'all') return true
  const priority = threadPriority(thread)
  if (filter === 'attention') return ['input', 'action'].includes(priority)
  if (filter === 'active') return agentIsWorking(agentThreadState(thread))
  if (filter === 'input') return priority === 'input'
  if (filter === 'action') return priority === 'action'
  if (filter === 'queued') return priority === 'queued'
  if (filter === 'completed') return priority === 'history' && thread.status === 'completed'
  return thread.status === filter
}

function threadTitle(job: Job) {
  const id = displayBackendId(job, job.id)
  if (job.kind === 'subagent') return job.task_title || `Child agent #${id}`
  if (job.kind === 'pre_pr') return job.task_title || `Task #${id}`
  if (job.kind === 'work_review') return job.task_title || 'Worktree code review'
  if (job.kind === 'stack_analysis') return 'PR stack analysis'
  if (job.kind === 'review') return job.task_title || `Review PR #${job.pr_number}`
  return job.task_title || (job.pr_number ? `PR #${job.pr_number}` : `Run #${id}`)
}

async function setThreadArchived(job: Job, archived: boolean, onChanged: () => void) {
  try {
    await api(`/api/agent-threads/${job.id}/archive`, { method: 'POST', body: JSON.stringify({ archived }) })
    toast.success(archived ? 'Agent run archived; worktree retained' : 'Agent run restored')
    onChanged()
  } catch (error) {
    toast.error((error as Error).message)
  }
}

async function applyDirectoryChanges(job: Job, confirmAction: ReturnType<typeof useConfirm>, onChanged: () => void) {
  try {
    const preview = await api<{ strategy: 'copy' | 'move'; changed: string[]; deleted: string[]; conflicts: string[] }>(
      `/api/agent-threads/${job.id}/directory-apply/preview`,
    )
    if (!preview.changed.length) return toast.info('No directory changes to apply')
    if (preview.conflicts.length) return toast.error(`${preview.conflicts.length} changed path(s) also changed in the source directory`)
    const confirmed = await confirmAction({
      title: preview.strategy === 'move' ? 'Replace the source directory?' : 'Apply directory changes?',
      description: `${preview.changed.length} changed path(s), including ${preview.deleted.length} deletion(s), will be applied to the original directory.${preview.strategy === 'move' ? ' VertexADE will stage the result and roll back if replacement fails.' : ''}`,
      confirmLabel: preview.strategy === 'move' ? 'Replace directory' : 'Apply changes',
      destructive: preview.strategy === 'move',
    })
    if (!confirmed) return
    await api(`/api/agent-threads/${job.id}/directory-apply`, { method: 'POST', body: '{}' })
    toast.success(`Applied ${preview.changed.length} changed path(s) to the source directory`)
    onChanged()
  } catch (error) {
    toast.error((error as Error).message)
  }
}

async function deleteThread(job: Job, onChanged: () => void, onDeleting: () => void, onDeleteFailed: () => void) {
  const toastId = toast.loading('Deleting agent run…', {
    description: `${threadTitle(job)} is hidden while deletion finishes.`,
  })
  onDeleting()
  try {
    const result = await api<{ worktree_removed: boolean }>(`/api/agent-threads/${job.id}`, {
      method: 'DELETE',
    })
    toast.success(result.worktree_removed ? 'Agent run and unused worktree deleted' : 'Agent run deleted; shared worktree retained', {
      id: toastId,
    })
    onChanged()
  } catch (error) {
    onDeleteFailed()
    toast.error('Deletion failed; agent run restored', {
      id: toastId,
      description: (error as Error).message,
    })
  }
}

function ThreadRunMenu({
  job,
  busy,
  onDetails,
  onFork,
  onChanged,
  onDeleting,
  onDeleteFailed,
}: {
  job: Job
  busy: boolean
  onDetails(): void
  onFork(): void
  onChanged(): void
  onDeleting(): void
  onDeleteFailed(): void
}) {
  const confirmAction = useConfirm()
  const remove = () =>
    void confirmAction({
      title: `Delete ${threadTitle(job)}?`,
      description: `This permanently deletes the ${job.agent_name} run. Its worktree is removed only when no other run uses it.`,
      confirmLabel: 'Delete agent run',
      destructive: true,
    }).then((confirmed) => {
      if (confirmed) return deleteThread(job, onChanged, onDeleting, onDeleteFailed)
    })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="absolute right-2 top-2" aria-label={`Actions for ${threadTitle(job)}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Agent run actions</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onDetails}>
          <FileText />
          Open run details
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={onFork}>
          <CopyPlus />
          Fork into worktree
        </DropdownMenuItem>
        {job.thread_url && (
          <DropdownMenuItem asChild>
            <a href={job.thread_url} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open in {job.agent_name}
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={busy} onSelect={() => void setThreadArchived(job, !job.archived_at, onChanged)}>
          {job.archived_at ? <ArchiveRestore /> : <Archive />}
          {job.archived_at ? 'Restore run' : 'Archive run'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={busy} onSelect={remove}>
          <Trash2 />
          Delete run
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ThreadFilters({
  repositories,
  repository,
  archiveView,
  statusFilter,
  agents,
  agent,
  sort,
  mobile = false,
  compact = false,
  onRepository,
  onArchiveView,
  onStatus,
  onAgent,
  onSort,
}: {
  repositories: string[]
  repository: string
  archiveView: 'open' | 'archived' | 'all'
  statusFilter: StatusFilter
  agents: [string, string][]
  agent: string
  sort: ThreadSort
  mobile?: boolean
  compact?: boolean
  onRepository(value: string): void
  onArchiveView(value: 'open' | 'archived' | 'all'): void
  onStatus(value: StatusFilter): void
  onAgent(value: string): void
  onSort(value: ThreadSort): void
}) {
  const triggerClass = mobile ? 'h-11 w-full sm:h-8 sm:w-auto' : compact ? 'h-7 w-full px-2 text-xs' : 'h-8 w-full'
  return (
    <div className={mobile ? 'contents' : compact ? 'grid grid-cols-3 gap-1' : 'grid grid-cols-2 gap-1.5'}>
      {(mobile || compact) && (
        <Select value={repository} onValueChange={onRepository}>
          <SelectTrigger className={cn('col-span-2', triggerClass)} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All project contexts</SelectItem>
            {repositories.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={archiveView} onValueChange={(value) => onArchiveView(value as typeof archiveView)}>
        <SelectTrigger className={triggerClass} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
          <SelectItem value="all">All runs</SelectItem>
        </SelectContent>
      </Select>
      <Select value={statusFilter} onValueChange={(value) => onStatus(value as StatusFilter)}>
        <SelectTrigger className={triggerClass} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="attention">Needs attention</SelectItem>
          <SelectItem value="input">Needs input</SelectItem>
          <SelectItem value="action">Action required</SelectItem>
          <SelectItem value="active">In progress</SelectItem>
          <SelectItem value="queued">Queued next</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
          <SelectItem value="resumable">Ready to resume</SelectItem>
        </SelectContent>
      </Select>
      <Select value={agent} onValueChange={onAgent}>
        <SelectTrigger className={triggerClass} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All agents</SelectItem>
          {agents.map(([id, name]) => (
            <SelectItem key={id} value={id}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={sort} onValueChange={(value) => onSort(value as ThreadSort)}>
        <SelectTrigger aria-label="Sort runs" className={triggerClass} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="priority">Priority first</SelectItem>
          <SelectItem value="recent">Recent first</SelectItem>
          <SelectItem value="oldest">Oldest first</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export function ThreadRailItem({
  job,
  selected,
  onSelect,
  onDetails,
  onFork,
  onChanged,
  onDeleting,
  onDeleteFailed,
}: {
  job: Job
  selected: boolean
  onSelect(): void
  onDetails(): void
  onFork(): void
  onChanged(): void
  onDeleting(): void
  onDeleteFailed(): void
}) {
  const state = agentThreadState(job)
  const priority = threadPriority(job)
  const busy = ['starting', 'running'].includes(job.status)
  const fileCount = job.diff_file_count ?? parseJson<unknown[]>(job.diff_files, []).length
  return (
    <article
      data-agent-provider={job.agent_id}
      data-agent-state={state}
      data-thread-priority={priority}
      data-thread-id={job.id}
      className={cn(
        'relative mb-px min-w-0 overflow-hidden rounded-md border border-transparent transition-colors hover:bg-accent/35',
        priority === 'input' && 'border-l-amber-400/70',
        priority === 'action' && 'border-l-red-400/70',
        selected && 'border-primary/20 bg-primary/[.07] shadow-[inset_3px_0_0_color-mix(in_srgb,var(--primary)_65%,transparent)]',
      )}
    >
      <button type="button" className="block w-full min-w-0 p-2 pr-9 text-left" onClick={onSelect}>
        <span className="flex min-w-0 items-start gap-2">
          <span className="relative">
            <AgentAvatar id={job.agent_id} name={job.agent_name} size="sm" />
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-background bg-muted-foreground',
                state === 'completed' && 'bg-emerald-500',
                agentIsWorking(state) && 'bg-blue-400',
                priority === 'input' && 'bg-amber-400',
                priority === 'action' && 'bg-red-500',
                priority === 'queued' && 'bg-violet-400',
              )}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <strong className="min-w-0 flex-1 truncate text-xs">{threadTitle(job)}</strong>
              <ThreadStateLabel state={state} queued={priority === 'queued'} />
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
              <FolderGit2 className="size-3 shrink-0" />
              <span title={job.full_name} className="max-w-28 truncate font-medium text-foreground/70">
                {job.full_name.split('/').at(-1)}
              </span>
              <BackendBadge source={job} />
              <span className="min-w-0 flex-1 truncate font-mono">{job.branch_name || `run #${displayBackendId(job, job.id)}`}</span>
            </span>
          </span>
        </span>
        <span className="mt-1 block truncate text-[11px] leading-4 text-muted-foreground" title={activityPreview(job.latest_activity)}>
          {activityPreview(job.latest_activity)}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
          <span className="truncate">
            {job.agent_name}
            {job.kind === 'subagent' && job.source_job_id ? ` · child of #${localBackendId(job.source_job_id)}` : ''} ·{' '}
            {age(job.activity_at || job.created_at)}
          </span>
          {fileCount > 0 && (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <span className="text-emerald-500">+{job.diff_additions}</span>
              <span className="text-red-500">−{job.diff_deletions}</span>
            </span>
          )}
        </span>
      </button>
      <ThreadRunMenu
        job={job}
        busy={busy}
        onDetails={onDetails}
        onFork={onFork}
        onChanged={onChanged}
        onDeleting={onDeleting}
        onDeleteFailed={onDeleteFailed}
      />
    </article>
  )
}

function ThreadStateLabel({ state, queued = false }: { state: ReturnType<typeof agentThreadState>; queued?: boolean }) {
  if (queued) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-violet-400">
        <span className="size-1.5 rounded-full bg-current" />
        Queued
      </span>
    )
  }
  const tones = {
    running: 'text-blue-400',
    starting: 'text-blue-400',
    waiting: 'text-amber-400',
    failed: 'text-red-400',
    completed: 'text-muted-foreground',
    resumable: 'text-amber-400',
    interrupted: 'text-amber-400',
    cancelled: 'text-muted-foreground',
    unknown: 'text-muted-foreground',
  }
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11px]', tones[state])}>
      <span className="size-1.5 rounded-full bg-current" />
      {agentThreadLabel(state)}
    </span>
  )
}

export function ThreadRow({
  job,
  onChat,
  onDetails,
  onFork,
  onChanged,
  onDeleting,
  onDeleteFailed,
}: {
  job: Job
  onChat: () => void
  onDetails: () => void
  onFork: () => void
  onChanged: () => void
  onDeleting: () => void
  onDeleteFailed: () => void
}) {
  const confirmAction = useConfirm()
  const state = agentThreadState(job)
  const priority = threadPriority(job)
  const fileCount = job.diff_file_count ?? parseJson<unknown[]>(job.diff_files, []).length
  const title = threadTitle(job)
  const busy = ['starting', 'running'].includes(job.status)
  const canApplyDirectory = !busy && ['copy', 'move'].includes(job.directory_workspace_strategy || '')
  return (
    <article
      data-agent-provider={job.agent_id}
      data-agent-state={state}
      data-thread-priority={priority}
      data-thread-id={job.id}
      data-thread-activity-at={job.activity_at || job.created_at}
      className={cn(
        'min-w-0 max-w-full rounded-md border border-border/70 bg-card/72 p-2.5 shadow-[0_1px_1px_rgba(0,0,0,.025)] transition-[background-color,border-color,box-shadow] hover:border-border hover:bg-card sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3 sm:p-3',
        priority === 'input' && 'border-amber-500/25 bg-amber-500/[.035]',
        priority === 'action' && 'border-red-500/20 bg-red-500/[.025]',
        job.pr_merged_at && 'bg-amber-500/[.035]',
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="relative">
            <AgentAvatar id={job.agent_id} name={job.agent_name} />
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-muted-foreground',
                state === 'completed' && 'bg-emerald-500',
                agentIsWorking(state) && 'bg-blue-400',
                priority === 'input' && 'bg-amber-400',
                priority === 'action' && 'bg-red-500',
                priority === 'queued' && 'bg-violet-400',
              )}
            />
          </div>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={onChat} className="block min-h-10 w-full text-left sm:min-h-0">
              <span className="flex items-start justify-between gap-2">
                <strong className="line-clamp-2 text-sm leading-5 sm:truncate">{title}</strong>
                <ThreadStateLabel state={state} queued={priority === 'queued'} />
              </span>
              <span className="mt-1 flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
                <span className="truncate">
                  {job.branch_name ? `${job.full_name} · ${job.branch_name}` : `${job.full_name} · run #${displayBackendId(job, job.id)}`}
                </span>
                <BackendBadge source={job} />
              </span>
            </button>
            <div className="mt-1 hidden flex-wrap items-center gap-1.5 sm:flex">
              <span className="text-[11px] font-medium">{job.agent_name}</span>
              <AgentContextBadges model={job.agent_model} reasoningEffort={job.agent_reasoning_effort} />
            </div>
          </div>
        </div>
        <div className="mt-1.5 sm:ml-[2.65rem] sm:mt-2">
          <p className="hidden text-xs leading-relaxed text-muted-foreground sm:line-clamp-1">{activityPreview(job.latest_activity)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3" />
              {duration(job.created_at, job.finished_at)} · {age(job.activity_at || job.created_at)}
            </span>
            {fileCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <GitCommitHorizontal className="size-3" />
                <span className="text-emerald-500">+{job.diff_additions}</span>
                <span className="text-red-500">−{job.diff_deletions}</span>
                <span>
                  {fileCount} file{fileCount === 1 ? '' : 's'}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 sm:ml-[2.65rem]">
          {job.kind === 'subagent' && job.source_job_id && (
            <Badge variant="secondary" className="text-[11px]">
              Child of run #{localBackendId(job.source_job_id)}
            </Badge>
          )}
          {job.subagent_integrated_at && (
            <Badge variant="outline" className="border-emerald-500/40 text-[11px] text-emerald-400">
              Changes integrated
            </Badge>
          )}
          {job.archived_at && (
            <Badge variant="secondary" className="text-[11px]">
              Archived
            </Badge>
          )}
          {job.linked_pr_number && (
            <Badge variant="outline" className="text-[11px]">
              Linked PR #{job.linked_pr_number}
            </Badge>
          )}
          {job.pr_merged_at && (
            <Badge variant="outline" className="border-amber-500/50 text-[11px] text-amber-500">
              PR merged · cleanup suggested
            </Badge>
          )}
          {canApplyDirectory && (
            <Button variant="outline" size="xs" onClick={() => void applyDirectoryChanges(job, confirmAction, onChanged)}>
              <FolderInput /> Apply to directory
            </Button>
          )}
        </div>
      </div>
      <div className={cn('mt-1.5 flex items-center justify-end gap-1 sm:hidden')}>
        <Button variant="secondary" size="xs" onClick={onChat}>
          <MessageSquareText />
          Open
        </Button>
        {job.thread_url && (
          <a
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'size-7')}
            href={job.thread_url}
            aria-label={`Open in ${job.agent_name}`}
          >
            <ExternalLink />
          </a>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-7" aria-label="More agent run actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Agent run actions</DropdownMenuLabel>
            <DropdownMenuItem className="min-h-11" onSelect={onDetails}>
              <FileText />
              Open run details
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" disabled={busy} onSelect={onFork}>
              <CopyPlus />
              Fork into worktree
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11"
              disabled={busy}
              onSelect={() => void setThreadArchived(job, !job.archived_at, onChanged)}
            >
              {job.archived_at ? <ArchiveRestore /> : <Archive />}
              {job.archived_at ? 'Restore run' : 'Archive run'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-11"
              variant="destructive"
              disabled={busy}
              onSelect={() =>
                void confirmAction({
                  title: `Delete ${title}?`,
                  description: `This permanently deletes the ${job.agent_name} run. Its worktree is removed only when no other run uses it.`,
                  confirmLabel: 'Delete agent run',
                  destructive: true,
                }).then((confirmed) => {
                  if (confirmed) return deleteThread(job, onChanged, onDeleting, onDeleteFailed)
                })
              }
            >
              <Trash2 />
              Delete run
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="hidden shrink-0 flex-wrap gap-1.5 sm:flex sm:justify-end">
        <Button size="sm" onClick={onChat}>
          <MessageSquareText />
          Chat
        </Button>
        <Button variant="ghost" size="sm" onClick={onDetails}>
          <FileText />
          Details
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={onFork}>
          <CopyPlus />
          Fork
        </Button>
        {job.thread_url && (
          <a className={buttonVariants({ variant: 'secondary', size: 'sm' })} href={job.thread_url}>
            <ExternalLink />
            {job.agent_name}
          </a>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void setThreadArchived(job, !job.archived_at, onChanged)}>
          {job.archived_at ? <ArchiveRestore /> : <Archive />}
          {job.archived_at ? 'Restore' : 'Archive'}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          className="text-red-400 hover:text-red-300"
          onClick={() =>
            void confirmAction({
              title: `Delete ${title}?`,
              description: `This permanently deletes the ${job.agent_name} run. Its worktree is removed only when no other run uses it.`,
              confirmLabel: 'Delete agent run',
              destructive: true,
            }).then((confirmed) => {
              if (confirmed) return deleteThread(job, onChanged, onDeleting, onDeleteFailed)
            })
          }
        >
          <Trash2 />
          <span className="sr-only">Delete agent run</span>
        </Button>
      </div>
    </article>
  )
}

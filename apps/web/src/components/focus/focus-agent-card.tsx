import { Link } from '@tanstack/react-router'
import { Archive, Bot, ExternalLink, ListPlus, Loader2, MessageSquareText, MoreHorizontal, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { AgentAvatar } from '@vertexade/ui/components/agent-identity'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { Input } from '@vertexade/ui/components/ui/input'
import { activityPreview } from '@vertexade/ui/lib/activity-preview'
import { agentIsWorking, agentThreadLabel, agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { age, api } from '@vertexade/ui/lib/dashboard-api'
import type { Job } from '@vertexade/ui/lib/dashboard-types'
import type { FollowUpDelivery } from '@vertexade/ui/lib/follow-up-delivery'
import { cn } from '@vertexade/ui/lib/utils'
import { firstInputQuestion, jobTitle, type AgentDockSection } from './focus-agent-model'

type AgentDockCardProps = {
  job: Job
  message: string
  sending: FollowUpDelivery | null
  onMessage: (message: string) => void
  onSend: (requested?: 'steer') => void
  onChanged: () => void
}

export function FocusAgentCard({ job, message, sending, onMessage, onSend, onChanged }: AgentDockCardProps) {
  const state = agentThreadState(job)
  const working = agentIsWorking(state)
  const waiting = state === 'waiting'
  const stateTone = waiting
    ? 'border-amber-500/35 bg-amber-500/[.04]'
    : state === 'failed'
      ? 'border-red-500/30 bg-red-500/[.035]'
      : 'bg-background/35'

  return (
    <article className={cn('relative rounded-lg border p-3', stateTone)}>
      <AgentCardMenu job={job} onChanged={onChanged} />
      <div className="flex min-w-0 items-start gap-2.5">
        <AgentAvatar id={job.agent_id} name={job.agent_name} accent={job.agent_accent} size="sm" />
        <div className="min-w-0 flex-1 pr-7">
          <div className="flex min-w-0 items-center gap-1.5">
            <strong className="truncate text-xs">{job.agent_name}</strong>
            <RunStateBadge state={state} />
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{age(job.activity_at || job.created_at)}</span>
          </div>
          <h3 className="mt-1 line-clamp-2 text-[11px] font-medium leading-snug">{jobTitle(job)}</h3>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{job.full_name}</p>
        </div>
      </div>
      {waiting ? (
        <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/[.045] p-2.5">
          <strong className="text-[11px] text-amber-200">Needs your answer</strong>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {firstInputQuestion(job) || 'Open the session to answer the agent’s structured question.'}
          </p>
        </div>
      ) : (
        <p className="mt-3 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          <span className="text-foreground">Current action: </span>
          {activityPreview(job.latest_activity || agentThreadLabel(state))}
        </p>
      )}
      {job.queued_follow_up_count ? (
        <Badge variant="outline" className="mt-2 border-amber-500/25 text-[11px] text-amber-300">
          <ListPlus />
          {job.queued_follow_up_count} queued
        </Badge>
      ) : null}
      {waiting ? (
        <Button asChild className="mt-3 w-fit" size="sm">
          <Link to="/threads/$threadId" params={{ threadId: String(job.id) }}>
            <MessageSquareText />
            Answer in session
          </Link>
        </Button>
      ) : (
        <AgentComposer
          job={job}
          message={message}
          sending={sending}
          working={working}
          onMessage={onMessage}
          onSend={onSend}
          onChanged={onChanged}
        />
      )}
    </article>
  )
}

function AgentCardMenu({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const confirmAction = useConfirm()
  const archive = async () => {
    try {
      await api(`/api/agent-threads/${job.id}/archive`, { method: 'POST', body: JSON.stringify({ archived: true }) })
      toast.success('Agent thread archived; worktree retained')
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }
  const remove = () =>
    void confirmAction({
      title: `Delete ${job.agent_name} thread?`,
      description: 'This permanently deletes the thread. Its worktree is removed only when no other thread uses it.',
      confirmLabel: 'Delete thread',
      destructive: true,
    }).then(async (confirmed) => {
      if (!confirmed) return
      try {
        await api(`/api/agent-threads/${job.id}`, { method: 'DELETE' })
        toast.success('Agent thread deleted')
        onChanged()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="absolute right-2 top-2 z-10" aria-label={`Actions for ${job.agent_name} thread`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Thread actions</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/threads/$threadId" params={{ threadId: String(job.id) }}>
            <ExternalLink /> Open thread
          </Link>
        </DropdownMenuItem>
        {job.thread_url && (
          <DropdownMenuItem asChild>
            <a href={job.thread_url} target="_blank" rel="noreferrer">
              <ExternalLink /> Open in {job.agent_name}
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void archive()}>
          <Archive /> Archive thread
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={remove}>
          <Trash2 /> Delete thread
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AgentComposer({ job, message, sending, working, onMessage, onSend }: AgentDockCardProps & { working: boolean }) {
  return (
    <div className="mt-3">
      <Input
        value={message}
        onChange={(event) => onMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && message.trim() && !sending) onSend()
        }}
        placeholder={working ? 'Add the next instruction…' : `Continue with ${job.agent_name}…`}
        aria-label={`Instruction for ${job.agent_name}`}
        className="h-9 text-[11px]"
      />
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={!message.trim() || Boolean(sending)}
          onClick={() => onSend()}
        >
          {sending && sending !== 'steer' ? <Loader2 className="animate-spin" /> : working ? <ListPlus /> : <Send />}
          {working ? 'Queue' : 'Continue'}
        </Button>
        {working && job.can_steer && (
          <Button type="button" size="sm" className="flex-1" disabled={!message.trim() || Boolean(sending)} onClick={() => onSend('steer')}>
            {sending === 'steer' ? <Loader2 className="animate-spin" /> : <Send />}Steer now
          </Button>
        )}
      </div>
    </div>
  )
}

function RunStateBadge({ state }: { state: ReturnType<typeof agentThreadState> }) {
  const tone =
    state === 'waiting'
      ? 'border-amber-500/30 text-amber-300'
      : state === 'failed'
        ? 'border-red-500/30 text-red-300'
        : agentIsWorking(state)
          ? 'border-emerald-500/30 text-emerald-300'
          : 'text-muted-foreground'
  return (
    <Badge variant="outline" className={cn('h-4 px-1.5 text-[11px]', tone)}>
      {agentThreadLabel(state)}
    </Badge>
  )
}

export function FocusAgentEmpty({ section }: { section: AgentDockSection }) {
  const copy = {
    input: ['No agents need input', 'Structured questions will appear here immediately.'],
    active: ['No agents are active', 'Delegate a task from the queue to start a session.'],
    recent: ['No recent sessions', 'Finished and resumable sessions will appear here.'],
  }[section]
  return (
    <div className="px-4 py-10 text-center">
      <Bot className="mx-auto size-5 text-muted-foreground" />
      <p className="mt-2 text-xs font-medium">{copy[0]}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{copy[1]}</p>
    </div>
  )
}

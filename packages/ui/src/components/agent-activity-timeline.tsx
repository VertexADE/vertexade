import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  Clipboard,
  FileCode2,
  FilePlus2,
  FileX2,
  GitBranch,
  ListChecks,
  Loader2,
  MessageSquareText,
  Terminal,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { DiffReview } from '@vertexade/ui/components/diff-review'
import type { FileReference } from '@vertexade/ui/components/markdown-content'
import { ThreadMarkdownContent } from '@vertexade/ui/components/thread-markdown-content'
import type { AgentAccent } from '@vertexade/ui/components/agent-identity'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { buildAgentTimeline, timelineSummary, type TimelineEvent } from '@vertexade/ui/lib/agent-timeline'
import { buildThreadWorkSessions, type ThreadWorkSession } from '@vertexade/ui/lib/thread-work-sessions'
import { agentIsWorking, agentThreadLabel, type AgentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { dateValue } from '@vertexade/ui/lib/dashboard-api'
import type { DiffFile, LogEvent } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

function timeLabel(value: string | null) {
  const date = dateValue(value)
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
}

function statusLabel(event: TimelineEvent) {
  const labels: Record<string, string> = {
    running: 'Running',
    pending: 'Running',
    failed: 'Failed',
    error: 'Failed',
    waiting: 'Waiting',
    paused: 'Paused',
    interrupted: 'Interrupted',
    completed: 'Done',
  }
  return labels[event.status || ''] || labels[event.kind] || ''
}

const eventIcons: Record<string, LucideIcon> = {
  running: Loader2,
  pending: Loader2,
  failed: CircleAlert,
  error: CircleAlert,
  waiting: CircleAlert,
  paused: CircleAlert,
  interrupted: CircleAlert,
  message: MessageSquareText,
  user_message: UserRound,
  action: Wrench,
  command: Terminal,
  changes: FileCode2,
  plan: ListChecks,
  started: GitBranch,
  completed: CheckCircle2,
}
const statusIconKeys: Record<string, string> = {
  running: 'running',
  pending: 'pending',
  failed: 'failed',
  waiting: 'waiting',
  paused: 'paused',
  interrupted: 'interrupted',
}
const actionIconKeys: Record<string, string> = {
  'action:commandexecution': 'command',
  'action:bash': 'command',
}

function eventIconKey(event: TimelineEvent) {
  const statusKey = statusIconKeys[String(event.status)]
  const actionKey = actionIconKeys[`${event.kind}:${String(event.action_kind).toLowerCase()}`]
  return [statusKey, actionKey, event.kind].find(Boolean)!
}

function EventIcon({ event }: { event: TimelineEvent }) {
  const key = eventIconKey(event)
  const Icon = eventIcons[key] || Circle
  return <Icon className={cn('size-3.5', ['running', 'pending'].includes(key) && 'animate-spin')} />
}

function eventTone(event: TimelineEvent) {
  const tones: Record<string, string> = {
    failed: 'border-red-500/35 bg-red-500/[.05] text-red-500',
    error: 'border-red-500/35 bg-red-500/[.05] text-red-500',
    running: 'border-blue-500/35 bg-blue-500/[.06] text-blue-500',
    pending: 'border-blue-500/35 bg-blue-500/[.06] text-blue-500',
    input: 'border-amber-500/35 bg-amber-500/[.06] text-amber-500',
    waiting: 'border-amber-500/35 bg-amber-500/[.06] text-amber-500',
    paused: 'border-amber-500/35 bg-amber-500/[.06] text-amber-500',
    interrupted: 'border-amber-500/35 bg-amber-500/[.06] text-amber-500',
    completed: 'border-emerald-500/30 bg-emerald-500/[.05] text-emerald-500',
    user_message: 'border-blue-500/35 bg-blue-500/[.06] text-blue-500',
  }
  return tones[event.status || ''] || tones[event.kind] || 'border-border bg-card text-muted-foreground'
}

function EventMeta({ event }: { event: TimelineEvent }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <ActionKind event={event} />
      <EventStatus event={event} />
      <EventTime event={event} />
      <ActionDuration event={event} />
    </div>
  )
}

function ActionKind({ event }: { event: TimelineEvent }) {
  if (!event.action_kind) return null
  return (
    <Badge variant="outline" className="hidden h-5 max-w-32 truncate px-1.5 font-mono text-xs sm:inline-flex">
      {event.action_kind}
    </Badge>
  )
}

function EventStatus({ event }: { event: TimelineEvent }) {
  const status = statusLabel(event)
  if (event.status === 'completed') return null
  return status ? <span className="font-medium">{status}</span> : null
}

function EventTime({ event }: { event: TimelineEvent }) {
  return event.time ? (
    <time dateTime={event.time} title={dateValue(event.time)?.toLocaleString()}>
      {timeLabel(event.time)}
    </time>
  ) : null
}

function ActionDuration({ event }: { event: TimelineEvent }) {
  if (event.duration_ms === undefined) return null
  const seconds = Math.max(0, Math.round(event.duration_ms / 1_000))
  return <span>· {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}</span>
}

function MessageEvent({
  event,
  onOpenFile,
  worktreePath,
}: {
  event: TimelineEvent
  onOpenFile: (reference: FileReference) => void
  worktreePath: string
}) {
  const user = event.kind === 'user_message'
  const Icon = user ? UserRound : Bot
  return (
    <article
      className={cn(
        'border-b border-border/45 bg-transparent px-1 pb-4 pt-1 sm:px-2',
        user && 'border-l-2 border-l-blue-500/35 bg-blue-500/[.025] pl-3 sm:pl-4',
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span
          className={cn(
            'grid size-6 place-items-center rounded-md bg-primary text-primary-foreground',
            user && 'bg-blue-500/15 text-blue-400',
          )}
        >
          <Icon className="size-3.5" />
        </span>
        {user ? <strong className="min-w-0 flex-1 truncate">{event.title}</strong> : <span className="min-w-0 flex-1" />}
        <EventMeta event={event} />
      </div>
      <ThreadMarkdownContent content={event.text} onOpenFile={onOpenFile} worktreePath={worktreePath} className="text-sm" />
    </article>
  )
}

function SessionMessage({
  event,
  onOpenFile,
  worktreePath,
}: {
  event?: TimelineEvent
  onOpenFile: (reference: FileReference) => void
  worktreePath: string
}) {
  if (!event) return null
  const user = event.kind === 'user_message'
  const copy = () => void navigator.clipboard.writeText(event.text).then(() => toast.success('Message copied'))
  return (
    <article className={cn('group/message flex min-w-0 flex-col gap-1', user ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'min-w-0 max-w-[min(88%,52rem)]',
          user ? 'rounded-2xl rounded-br-md bg-blue-600 px-3.5 py-2.5 text-white shadow-sm' : 'w-full px-1 py-1',
        )}
      >
        <ThreadMarkdownContent
          content={event.text}
          onOpenFile={onOpenFile}
          worktreePath={worktreePath}
          className={cn('text-sm', user && '[&_a]:text-white [&_code]:bg-white/15 [&_code]:text-white')}
        />
      </div>
      <div className={cn('flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground', user && 'flex-row-reverse')}>
        <EventTime event={event} />
        <button type="button" onClick={copy} className="rounded p-1 opacity-60 hover:bg-muted hover:opacity-100" aria-label="Copy message">
          <Clipboard className="size-3" />
        </button>
      </div>
    </article>
  )
}

function WorkSession({
  session,
  index,
  onOpenFile,
  worktreePath,
}: {
  session: ThreadWorkSession
  index: number
  onOpenFile: (reference: FileReference) => void
  worktreePath: string
}) {
  return (
    <section id={`thread-turn-${index + 1}`} className="scroll-mt-20 space-y-3" data-thread-work-session>
      <SessionMessage event={session.trigger} onOpenFile={onOpenFile} worktreePath={worktreePath} />
      {session.activity.length ? (
        <details className="group/session overflow-hidden rounded-xl border border-border/55 bg-muted/[.08]" open={!session.complete}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs hover:bg-muted/25">
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open/session:rotate-90" />
            <strong>{session.complete ? `Worked for ${session.duration}` : 'Agent is working'}</strong>
            <span className="text-muted-foreground">
              {session.activity.length} {session.activity.length === 1 ? 'update' : 'updates'}
              {session.actions ? ` · ${session.actions} ${session.actions === 1 ? 'action' : 'actions'}` : ''}
            </span>
            {!session.complete ? <Loader2 className="ml-auto size-3.5 animate-spin text-blue-500" /> : null}
          </summary>
          <ol className="relative border-t border-border/45 px-3 py-3 before:absolute before:bottom-6 before:left-[1.98rem] before:top-6 before:w-px before:bg-border">
            {session.activity.map((event) => (
              <TimelineEntry key={event.key} event={event} onOpenFile={onOpenFile} worktreePath={worktreePath} />
            ))}
          </ol>
        </details>
      ) : null}
      <SessionMessage event={session.finalMessage} onOpenFile={onOpenFile} worktreePath={worktreePath} />
      {session.changes ? (
        <div className="flex justify-end" aria-label="Changes made in this turn">
          <ChangesEvent event={session.changes} onOpenFile={onOpenFile} />
        </div>
      ) : null}
    </section>
  )
}

function CopyAction({ event }: { event: TimelineEvent }) {
  if (event.kind !== 'action' || !event.text) return null
  const copy = () => {
    void navigator.clipboard.writeText(event.text).then(() => toast.success('Action details copied'))
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="grid size-8 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      title="Copy action details"
      aria-label="Copy action details"
    >
      <Clipboard className="size-3.5" />
    </button>
  )
}

function diffFiles(event: TimelineEvent) {
  const summary = event.data?.diff_summary
  if (!summary || typeof summary !== 'object' || !('files' in summary) || !Array.isArray(summary.files)) return []
  return summary.files.flatMap((value): DiffFile[] => {
    if (!value || typeof value !== 'object' || !('path' in value) || typeof value.path !== 'string') return []
    const status =
      'status' in value && ['added', 'deleted', 'renamed'].includes(String(value.status))
        ? (value.status as DiffFile['status'])
        : 'modified'
    return [
      {
        path: value.path,
        additions: 'additions' in value ? Number(value.additions || 0) : 0,
        deletions: 'deletions' in value ? Number(value.deletions || 0) : 0,
        status,
        binary: 'binary' in value && value.binary === true,
      },
    ]
  })
}

function diffPatch(event: TimelineEvent) {
  return typeof event.data?.diff === 'string' ? event.data.diff : ''
}

function fileStatus(file: DiffFile) {
  if (file.status === 'added') return { label: 'Added', Icon: FilePlus2, tone: 'text-emerald-500' }
  if (file.status === 'deleted') return { label: 'Deleted', Icon: FileX2, tone: 'text-red-500' }
  if (file.status === 'renamed') return { label: 'Renamed', Icon: GitBranch, tone: 'text-violet-500' }
  return { label: 'Modified', Icon: FileCode2, tone: 'text-blue-500' }
}

function ChangesEvent({ event, onOpenFile }: { event: TimelineEvent; onOpenFile: (reference: FileReference) => void }) {
  const files = diffFiles(event)
  const patch = diffPatch(event)
  if (!files.length) return <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{event.text}</p>
  return (
    <details className="group/details mt-1 w-full max-w-full overflow-hidden rounded-md border bg-background/60">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-[11px] hover:bg-muted/30">
        <FileCode2 className="size-3.5 shrink-0 text-blue-500" />
        <strong>
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </strong>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{event.text.split('\n', 1)[0] || 'File changes'}</span>
        <span className="font-mono text-emerald-500">+{files.reduce((total, file) => total + Number(file.additions || 0), 0)}</span>
        <span className="font-mono text-red-500">−{files.reduce((total, file) => total + Number(file.deletions || 0), 0)}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/details:rotate-180" />
      </summary>
      {event.text ? (
        <p className="whitespace-pre-wrap break-words border-t px-2.5 py-2 text-xs text-muted-foreground">{event.text}</p>
      ) : null}
      {patch ? (
        <div className="min-w-0 border-t p-2">
          <DiffReview patch={patch} files={files} />
        </div>
      ) : (
        <ul className="max-h-72 divide-y overflow-auto">
          {files.map((file) => {
            const status = fileStatus(file)
            return (
              <li key={`${file.status}-${file.path}`} className="min-w-0 text-xs">
                <button
                  type="button"
                  disabled={file.binary || file.status === 'deleted'}
                  onClick={() => onOpenFile({ path: file.path, line: 1 })}
                  className="flex min-h-9 w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
                  title={
                    file.binary ? 'Binary files cannot be previewed' : file.status === 'deleted' ? 'Deleted file' : `Open ${file.path}`
                  }
                >
                  <status.Icon className={cn('size-3.5 shrink-0', status.tone)} aria-label={status.label} />
                  <span className="min-w-0 flex-1 truncate font-mono text-foreground">{file.path}</span>
                  {file.binary ? (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      Binary
                    </Badge>
                  ) : (
                    <span className="flex shrink-0 gap-1.5 font-mono">
                      <span className="text-emerald-500">+{file.additions || 0}</span>
                      <span className="text-red-500">−{file.deletions || 0}</span>
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}

function actionPayload(event: TimelineEvent) {
  const started = event.data?.started
  const completed = event.data?.completed
  const sources = [started, completed, event.data].filter((source): source is Record<string, unknown> =>
    Boolean(source && typeof source === 'object'),
  )
  return sources.reduce<Record<string, unknown>>((result, source) => {
    const action = 'action' in source && source.action && typeof source.action === 'object' ? source.action : {}
    const tool = 'tool' in source && source.tool && typeof source.tool === 'object' ? source.tool : {}
    return { ...result, ...tool, ...action }
  }, {})
}

function actionSummary(event: TimelineEvent) {
  const payload = actionPayload(event)
  const command = typeof payload.command === 'string' ? payload.command : undefined
  return command || event.text.split('\n', 1)[0] || event.title
}

function EventText({ event, onOpenFile }: { event: TimelineEvent; onOpenFile: (reference: FileReference) => void }) {
  if (!event.text) return null
  if (event.kind === 'changes') return <ChangesEvent event={event} onOpenFile={onOpenFile} />
  return <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{event.text}</p>
}

function eventCardClass(event: TimelineEvent) {
  const tones: Record<string, string> = {
    error: 'border-l-2 border-l-red-500/40 bg-red-500/[.025] pl-3',
    input: 'border-l-2 border-l-amber-500/40 bg-amber-500/[.025] pl-3',
  }
  return cn('min-w-0 border-b border-border/45 bg-transparent px-1 pb-4 pt-1 sm:px-2', tones[event.kind])
}

function TimelineRow({ event, onOpenFile }: { event: TimelineEvent; onOpenFile: (reference: FileReference) => void }) {
  const terminal = event.kind === 'completed'
  if (event.kind === 'action') {
    return (
      <li className="relative min-w-0 py-0.5 text-[11px] text-muted-foreground">
        <details className="group/details w-full max-w-xl overflow-hidden rounded-md border border-transparent hover:border-border/55 hover:bg-muted/20">
          <summary className="flex min-h-7 cursor-pointer list-none items-center gap-2 px-1.5 py-1">
            <EventIcon event={event} />
            <strong className="shrink-0 font-medium text-foreground/80">{event.title}</strong>
            <span className="min-w-0 flex-1 truncate font-mono">{actionSummary(event)}</span>
            <EventStatus event={event} />
            <ActionDuration event={event} />
            <ChevronDown className="size-3 shrink-0 transition-transform group-open/details:rotate-180" />
          </summary>
          <div className="border-t border-border/45 px-2.5 py-2">
            <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/80">{event.text}</p>
            <div className="mt-1 flex justify-end">
              <CopyAction event={event} />
            </div>
          </div>
        </details>
      </li>
    )
  }
  return (
    <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-2.5 pb-3 last:pb-0 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:gap-3">
      <span className={cn('relative z-10 grid size-8 place-items-center rounded-full border border-border/55 sm:size-9', eventTone(event))}>
        <EventIcon event={event} />
      </span>
      <article className={eventCardClass(event)}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-xs font-medium text-foreground">{terminal ? 'Run completed' : event.title}</strong>
            {!terminal ? <EventText event={event} onOpenFile={onOpenFile} /> : null}
          </div>
          <EventMeta event={event} />
          <CopyAction event={event} />
        </div>
      </article>
    </li>
  )
}

function TimelineEntry({
  event,
  onOpenFile,
  worktreePath,
}: {
  event: TimelineEvent
  onOpenFile: (reference: FileReference) => void
  worktreePath: string
}) {
  if (['message', 'user_message'].includes(event.kind))
    return (
      <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-2.5 pb-3 last:pb-0 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:gap-3">
        <span
          className={cn('relative z-10 grid size-8 place-items-center rounded-full border border-border/55 sm:size-9', eventTone(event))}
        >
          <EventIcon event={event} />
        </span>
        <MessageEvent event={event} onOpenFile={onOpenFile} worktreePath={worktreePath} />
      </li>
    )
  return <TimelineRow event={event} onOpenFile={onOpenFile} />
}

export function AgentActivityTimeline({
  events,
  state,
  onOpenFile,
  worktreePath,
}: {
  events: LogEvent[]
  content: string
  state: AgentThreadState
  agent?: {
    id: string
    name: string
    accent?: AgentAccent
    model?: string | null
    reasoningEffort?: string | null
  }
  onOpenFile: (reference: FileReference) => void
  worktreePath: string
}) {
  const timeline = buildAgentTimeline(events, state)
  const visible = timeline.filter((event) => event.kind !== 'technical')
  const summary = timelineSummary(timeline, state)
  const sessions = buildThreadWorkSessions(visible, state === 'completed')
  return (
    <section className="relative space-y-3" data-agent-timeline>
      <header className="sticky top-0 z-20 flex items-center gap-2 border-y border-border/55 bg-background/95 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <ListChecks className="size-4 text-muted-foreground" />
        <strong className="text-xs">Activity</strong>
        <span className="text-xs text-muted-foreground">
          {summary.visible} updates{summary.actions ? ` · ${summary.actions} actions` : ''}
        </span>
        {agentIsWorking(state) ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-blue-500">
            <Loader2 className="size-3 animate-spin" />
            {agentThreadLabel(state)}
          </span>
        ) : null}
      </header>
      <div className="relative">
        <TurnRail sessions={sessions} />
        <div className="space-y-5">
          {sessions.map((session, index) => (
            <WorkSession key={session.key} session={session} index={index} onOpenFile={onOpenFile} worktreePath={worktreePath} />
          ))}
        </div>
      </div>
    </section>
  )
}

function TurnRail({ sessions }: { sessions: ThreadWorkSession[] }) {
  if (sessions.length < 2) return null
  return (
    <nav aria-label="Conversation turns" className="absolute right-full top-0 mr-3 hidden h-full w-8 lg:block">
      <ol className="sticky top-14 flex flex-col items-center gap-1.5 rounded-full border bg-background/90 px-1 py-1.5 shadow-sm backdrop-blur">
        {sessions.map((session, index) => (
          <li key={session.key}>
            <a
              href={`#thread-turn-${index + 1}`}
              className={cn(
                'grid size-6 place-items-center rounded-full text-[10px] font-semibold transition-colors hover:bg-blue-500/15 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                session.complete ? 'bg-muted text-muted-foreground' : 'bg-blue-500 text-white',
              )}
              title={`Jump to turn ${index + 1}${session.duration ? ` · ${session.duration}` : ''}`}
              aria-label={`Jump to turn ${index + 1}`}
            >
              {index + 1}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

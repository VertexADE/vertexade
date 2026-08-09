import {
  Bot,
  CheckCircle2,
  ChevronDown,
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
import { MarkdownContent, type FileReference } from '@vertexade/ui/components/markdown-content'
import type { AgentAccent } from '@vertexade/ui/components/agent-identity'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { buildAgentTimeline, timelineSummary, type TimelineEvent } from '@vertexade/ui/lib/agent-timeline'
import { agentIsWorking, agentThreadLabel, type AgentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { dateValue } from '@vertexade/ui/lib/dashboard-api'
import type { LogEvent } from '@vertexade/ui/lib/dashboard-types'
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

function RawEvent({ event }: { event: TimelineEvent }) {
  if (!event.data) return null
  return (
    <details className="mt-2 rounded-md border bg-background/70 text-xs text-muted-foreground">
      <summary className="cursor-pointer px-2.5 py-1.5 font-medium">Technical details</summary>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all border-t p-2.5 leading-relaxed">
        {JSON.stringify(event.data, null, 2)}
      </pre>
    </details>
  )
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
        <strong className="min-w-0 flex-1 truncate">{event.title}</strong>
        <EventMeta event={event} />
      </div>
      <MarkdownContent content={event.text} onOpenFile={onOpenFile} worktreePath={worktreePath} className="text-sm" />
    </article>
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

type DiffFile = {
  path: string
  additions?: number
  deletions?: number
  status?: string
  binary?: boolean
}

function diffFiles(event: TimelineEvent) {
  const summary = event.data?.diff_summary
  if (!summary || typeof summary !== 'object' || !('files' in summary) || !Array.isArray(summary.files)) return []
  return summary.files as DiffFile[]
}

function fileStatus(file: DiffFile) {
  if (file.status === 'added') return { label: 'Added', Icon: FilePlus2, tone: 'text-emerald-500' }
  if (file.status === 'deleted') return { label: 'Deleted', Icon: FileX2, tone: 'text-red-500' }
  if (file.status === 'renamed') return { label: 'Renamed', Icon: GitBranch, tone: 'text-violet-500' }
  return { label: 'Modified', Icon: FileCode2, tone: 'text-blue-500' }
}

function ChangesEvent({ event, onOpenFile }: { event: TimelineEvent; onOpenFile: (reference: FileReference) => void }) {
  const files = diffFiles(event)
  if (!files.length) return <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{event.text}</p>
  return (
    <div className="mt-2 overflow-hidden rounded-lg border bg-background/60">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/30 px-2.5 py-2 text-xs">
        <strong>
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </strong>
        <span className="font-mono text-emerald-500">+{files.reduce((total, file) => total + Number(file.additions || 0), 0)}</span>
        <span className="font-mono text-red-500">−{files.reduce((total, file) => total + Number(file.deletions || 0), 0)}</span>
      </div>
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
                title={file.binary ? 'Binary files cannot be previewed' : file.status === 'deleted' ? 'Deleted file' : `Open ${file.path}`}
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
    </div>
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

function ActionEvent({ event }: { event: TimelineEvent }) {
  if (!event.text) return null
  const payload = actionPayload(event)
  const command = typeof payload.command === 'string' ? payload.command : undefined
  const input = payload.input && typeof payload.input === 'object' ? payload.input : undefined
  const resultLabel = command || input ? 'Result' : 'Details'
  return (
    <div className="mt-2 space-y-2">
      {command && (
        <pre className="overflow-x-auto rounded-lg border bg-muted/35 px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground">
          <code>{command}</code>
        </pre>
      )}
      {!command && input && (
        <details className="group rounded-lg border bg-muted/20">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-xs font-medium">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            Input
          </summary>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t px-2.5 py-2 font-mono text-xs leading-relaxed">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      )}
      <details className="group rounded-lg border bg-background/60" open={event.status === 'failed'}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-muted-foreground">
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          {resultLabel}
        </summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t px-2.5 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {event.text}
        </pre>
      </details>
    </div>
  )
}

function EventText({ event, onOpenFile }: { event: TimelineEvent; onOpenFile: (reference: FileReference) => void }) {
  if (!event.text) return null
  if (event.kind === 'changes') return <ChangesEvent event={event} onOpenFile={onOpenFile} />
  if (event.kind === 'action') return <ActionEvent event={event} />
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
        <RawEvent event={event} />
      </article>
    </li>
  )
}

function TimelineDiagnostics({ events, content }: { events: TimelineEvent[]; content: string }) {
  return (
    <details className="border-y border-border/55 bg-muted/[.08] p-3">
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-[.12em] text-muted-foreground">
        Diagnostics{events.length ? ` · ${events.length} system ${events.length === 1 ? 'event' : 'events'}` : ''}
      </summary>
      <div className="mt-3 space-y-3">
        {events.length ? (
          <div className="space-y-2">
            {events.map((event) => (
              <RawEvent key={event.key} event={event} />
            ))}
          </div>
        ) : null}
        <details className="rounded-md border bg-background/70 text-xs text-muted-foreground">
          <summary className="cursor-pointer px-2.5 py-1.5 font-medium">Raw session log</summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all border-t p-2.5 leading-relaxed">{content}</pre>
        </details>
      </div>
    </details>
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
  content,
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
  const technical = timeline.filter((event) => event.kind === 'technical')
  const summary = timelineSummary(timeline, state)
  return (
    <section className="space-y-3" data-agent-timeline>
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
      <ol className="relative before:absolute before:bottom-4 before:left-[.98rem] before:top-4 before:w-px before:bg-border sm:before:left-[1.1rem]">
        {visible.map((event) => (
          <TimelineEntry key={event.key} event={event} onOpenFile={onOpenFile} worktreePath={worktreePath} />
        ))}
      </ol>
      <TimelineDiagnostics events={technical} content={content} />
    </section>
  )
}

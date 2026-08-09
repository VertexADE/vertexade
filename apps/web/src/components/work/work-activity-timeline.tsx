import { useMemo, useState } from 'react'
import { Bot, ChevronRight, GitPullRequest, History, Layers3 } from 'lucide-react'
import { AgentAvatar, agentDisplayName } from '@vertexade/ui/components/agent-identity'
import { Button } from '@vertexade/ui/components/ui/button'
import { activityPreview } from '@vertexade/ui/lib/activity-preview'
import { agentIsWorking, agentThreadLabel, agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

type WorkResource = WorkItem['resources'][number]
type ActivityCategory = 'agent' | 'git' | 'system'
type ActivityFilter = 'important' | ActivityCategory

type ActivityEntry = {
  id: string
  at: string
  title: string
  detail: string
  category: ActivityCategory
  agentId?: string
  tone?: 'working' | 'success' | 'failed'
  count?: number
  onOpen?: () => void
}

const filters: { id: ActivityFilter; label: string }[] = [
  { id: 'important', label: 'Important' },
  { id: 'agent', label: 'Agent threads' },
  { id: 'git', label: 'Pull requests' },
  { id: 'system', label: 'System' },
]

function eventCategory(eventType: string): ActivityCategory {
  return /(pull|resource|review|merge|branch|commit)/i.test(eventType) ? 'git' : 'system'
}

function eventKey(entry: ActivityEntry) {
  return `${entry.category}:${entry.title.toLowerCase()}`
}

function groupedEvent(entry: ActivityEntry, existing?: ActivityEntry) {
  return existing ? { ...existing, count: (existing.count || 1) + 1 } : { ...entry, id: eventKey(entry), count: 1 }
}

function eventGroupKey(entry: ActivityEntry) {
  return entry.category === 'agent' || entry.onOpen ? entry.id : eventKey(entry)
}

function groupEvents(entries: ActivityEntry[]) {
  const grouped = new Map<string, ActivityEntry>()
  for (const entry of entries) {
    const key = eventGroupKey(entry)
    grouped.set(key, key === entry.id ? entry : groupedEvent(entry, grouped.get(key)))
  }
  return [...grouped.values()].sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
}

const terminalJobTitles = {
  completed: 'completed a thread',
  failed: 'needs attention',
} as const

function jobStateTitle(state: ReturnType<typeof agentThreadState>) {
  if (agentIsWorking(state)) return state === 'waiting' ? 'is waiting for you' : 'is working'
  return terminalJobTitles[state as keyof typeof terminalJobTitles] || agentThreadLabel(state).toLowerCase()
}

function jobTone(state: ReturnType<typeof agentThreadState>): ActivityEntry['tone'] {
  if (agentIsWorking(state)) return 'working'
  return state === 'completed' ? 'success' : state === 'failed' ? 'failed' : undefined
}

function firstActivityText(...values: Array<string | null | undefined>) {
  return values.find(Boolean) || ''
}

function jobActivityEntry(job: WorkItem['threads'][number], onOpenRun: (jobId: number) => void): ActivityEntry {
  const state = agentThreadState(job)
  const agentName = agentDisplayName(job.agent_id)
  return {
    id: `job:${job.id}`,
    at: firstActivityText(job.activity_at, job.finished_at, job.created_at),
    title: `${agentName} ${jobStateTitle(state)}`,
    detail: `${job.full_name} · ${activityPreview(firstActivityText(job.latest_activity, job.task_title, job.full_name))}`,
    category: 'agent',
    agentId: job.agent_id,
    tone: jobTone(state),
    onOpen: () => onOpenRun(job.id),
  }
}

function activityEntries(item: WorkItem, onOpenRun: (jobId: number) => void, onOpenPullRequest: (resource: WorkResource) => void) {
  const threads = item.threads.map((thread) => jobActivityEntry(thread, onOpenRun))
  const events: ActivityEntry[] = item.events.map((event) => ({
    id: `event:${event.id}`,
    at: event.created_at,
    title: event.summary,
    detail: `${event.event_type.replaceAll('_', ' ')} · ${event.actor}`,
    category: eventCategory(event.event_type),
  }))
  const pullRequests: ActivityEntry[] = item.resources
    .filter((resource) => resource.kind === 'pull_request' && resource.role !== 'context')
    .map((resource) => ({
      id: `resource:${resource.id}:${resource.role}`,
      at: item.updated_at,
      title: resource.state ? `Pull request ${resource.state.replaceAll('_', ' ')}` : 'Pull request linked',
      detail: resource.label,
      category: 'git',
      tone: resource.state?.toLowerCase().includes('merged') ? 'success' : undefined,
      onOpen: () => onOpenPullRequest(resource),
    }))
  return groupEvents([...threads, ...events, ...pullRequests])
}

function visibleForFilter(entry: ActivityEntry, filter: ActivityFilter) {
  if (filter !== 'important') return entry.category === filter
  return entry.category !== 'system' || entry.tone === 'failed' || entry.tone === 'working'
}

const agentToneClasses = {
  working: 'bg-blue-400',
  success: 'bg-emerald-400',
  failed: 'bg-red-400',
}

function AgentActivityIcon({ agentId, tone }: { agentId: string; tone?: ActivityEntry['tone'] }) {
  const toneClass = tone ? agentToneClasses[tone] : undefined
  return (
    <span className="relative">
      <AgentAvatar id={agentId} name={agentDisplayName(agentId)} size="sm" />
      <span className={cn('absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-background bg-slate-400', toneClass)} />
    </span>
  )
}

const eventCategoryIcons = {
  agent: History,
  git: GitPullRequest,
  system: History,
}

const eventCategoryStyles = {
  agent: { container: undefined, icon: undefined },
  git: { container: 'border-violet-500/25 bg-violet-500/[.07]', icon: 'text-violet-400' },
  system: { container: undefined, icon: undefined },
}

function EventActivityIcon({ category, count }: Pick<ActivityEntry, 'category' | 'count'>) {
  const Icon = Number(count) > 1 ? Layers3 : eventCategoryIcons[category]
  const styles = eventCategoryStyles[category]
  return (
    <span className={cn('grid size-8 place-items-center rounded-lg border bg-muted/20', styles.container)}>
      <Icon className={cn('size-4 text-muted-foreground', styles.icon)} />
    </span>
  )
}

function ActivityEntryIcon({ entry }: { entry: ActivityEntry }) {
  return entry.agentId ? (
    <AgentActivityIcon agentId={entry.agentId} tone={entry.tone} />
  ) : (
    <EventActivityIcon category={entry.category} count={entry.count} />
  )
}

function dayGroup(value: string) {
  const date = new Date(value)
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  if (day === start) return 'Today'
  if (day === start - 86_400_000) return 'Yesterday'
  return 'Earlier'
}

function timelineCount(count: number | undefined) {
  return Number(count) > 1 ? ` · ${count} updates` : ''
}

function timelineEntryClass(tone: ActivityEntry['tone']) {
  return cn(
    'flex min-h-14 w-full items-center gap-3 border-t px-3 py-3 text-left first:border-t-0 hover:bg-accent/35',
    tone === 'failed' ? 'bg-red-500/[.025]' : undefined,
  )
}

function TimelineEntryContent({ entry }: { entry: ActivityEntry }) {
  return (
    <>
      <ActivityEntryIcon entry={entry} />
      <span className="min-w-0 flex-1">
        <strong className="block text-xs leading-snug">
          {entry.title}
          {timelineCount(entry.count)}
        </strong>
        <small className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-muted-foreground">{entry.detail}</small>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
        <time>{age(entry.at)}</time>
        {entry.onOpen ? <ChevronRight className="size-4" /> : null}
      </span>
    </>
  )
}

function TimelineEntry({ entry }: { entry: ActivityEntry }) {
  const content = <TimelineEntryContent entry={entry} />
  const className = timelineEntryClass(entry.tone)
  if (entry.onOpen)
    return (
      <button type="button" onClick={entry.onOpen} className={className}>
        {content}
      </button>
    )
  return <div className={className}>{content}</div>
}

export function WorkActivityTimeline({
  item,
  onOpenRun,
  onOpenPullRequest,
}: {
  item: WorkItem
  onOpenRun(jobId: number): void
  onOpenPullRequest(resource: WorkResource): void
}) {
  const [filter, setFilter] = useState<ActivityFilter>('important')
  const [limit, setLimit] = useState(12)
  const entries = useMemo(() => activityEntries(item, onOpenRun, onOpenPullRequest), [item, onOpenPullRequest, onOpenRun])
  const filtered = entries.filter((entry) => visibleForFilter(entry, filter))
  const visible = filtered.slice(0, limit)
  const groups = visible.reduce<Map<string, ActivityEntry[]>>((result, entry) => {
    const label = dayGroup(entry.at)
    result.set(label, [...(result.get(label) || []), entry])
    return result
  }, new Map())

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border">
      <header className="border-b p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Timeline</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Meaningful agent, review, and system changes.</p>
          </div>
          <span className="text-xs text-muted-foreground">{filtered.length}</span>
        </div>
        <div className="-mx-3 mt-3 flex snap-x gap-1 overflow-x-auto px-3 pb-0.5 [mask-image:linear-gradient(to_right,#000_calc(100%-1rem),transparent)] [scrollbar-width:none] sm:[mask-image:none] [&::-webkit-scrollbar]:hidden">
          {filters.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={filter === entry.id}
              onClick={() => {
                setFilter(entry.id)
                setLimit(12)
              }}
              className={cn(
                'min-h-10 shrink-0 snap-start rounded-lg border px-3 text-xs font-medium transition-colors',
                filter === entry.id
                  ? 'border-primary/35 bg-primary/[.09] text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-muted/50',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>
      {groups.size ? (
        [...groups].map(([label, group]) => (
          <section key={label} aria-labelledby={`activity-${label.toLowerCase()}`}>
            <h3
              id={`activity-${label.toLowerCase()}`}
              className="border-b bg-muted/15 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {label}
            </h3>
            {group.map((entry) => (
              <TimelineEntry key={entry.id} entry={entry} />
            ))}
          </section>
        ))
      ) : (
        <div className="px-4 py-10 text-center">
          <Bot className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No matching activity</p>
          <p className="mt-1 text-xs text-muted-foreground">Choose another timeline filter.</p>
        </div>
      )}
      {filtered.length > visible.length && (
        <footer className="border-t p-3">
          <Button className="w-full" variant="outline" onClick={() => setLimit((value) => value + 12)}>
            Show earlier activity
          </Button>
        </footer>
      )}
    </section>
  )
}

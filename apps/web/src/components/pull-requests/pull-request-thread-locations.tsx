import { Bot, FileSearch } from 'lucide-react'
import { agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { isReviewJob } from '@vertexade/ui/lib/activity-status'
import { Button } from '@vertexade/ui/components/ui/button'
import type { Job } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

type ThreadLocation = {
  key: string
  kind: 'Review' | 'Work'
  backendName: string
  state: ReturnType<typeof agentThreadState>
  latest: Job
  count: number
}

function threadLocations(threads: Job[]): ThreadLocation[] {
  const locations = new Map<string, ThreadLocation>()
  for (const thread of [...threads].sort((left, right) => right.id - left.id)) {
    const kind = isReviewJob(thread) ? 'Review' : 'Work'
    const backendName = thread.backend_name || 'Local server'
    const key = `${kind}:${thread.backend_id || 'local'}`
    const existing = locations.get(key)
    if (existing) existing.count += 1
    else locations.set(key, { key, kind, backendName, state: agentThreadState(thread), latest: thread, count: 1 })
  }
  return [...locations.values()]
}

export function PullRequestThreadLocations({ threads, onRun }: { threads: Job[]; onRun(id: number): void }) {
  const locations = threadLocations(threads)
  if (!locations.length) return null
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="PR work and review locations">
      {locations.map((location) => (
        <Button
          key={location.key}
          type="button"
          variant="outline"
          size="xs"
          className="h-6 max-w-full gap-1.5 rounded-full px-2 text-[10px]"
          title={`${location.kind} ${location.state} on ${location.backendName}. The worktree, logs, and thread are stored there.`}
          onClick={() => onRun(location.latest.id)}
        >
          {location.kind === 'Review' ? <FileSearch /> : <Bot />}
          <span className="font-semibold">{location.kind}</span>
          <span aria-hidden="true">·</span>
          <span className="max-w-28 truncate">{location.backendName}</span>
          {location.count > 1 && <span>×{location.count}</span>}
          <span
            className={cn(
              'size-1.5 rounded-full',
              ['running', 'starting', 'waiting'].includes(location.state)
                ? 'bg-blue-400'
                : location.state === 'completed'
                  ? 'bg-emerald-400'
                  : 'bg-amber-400',
            )}
          />
        </Button>
      ))}
    </div>
  )
}

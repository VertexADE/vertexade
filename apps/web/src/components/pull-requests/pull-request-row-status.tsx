import { useState } from 'react'
import { AlertTriangle, Bot, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { AgentReviewStatusControls } from '@vertexade/ui/components/agent-review-status'
import { Button } from '@vertexade/ui/components/ui/button'
import { age, api } from '@vertexade/ui/lib/dashboard-api'
import type { PullRequest } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { reconcilePullRequestChange } from '../../lib/use-pull-request-mutation'

export function PrSignal({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <strong className={cn('truncate font-medium', className)} title={value}>
        {value}
      </strong>
    </span>
  )
}
export function AgentReviewStatus({
  pr,
  onRun,
  onChanged,
}: {
  pr: PullRequest
  onRun: (id: number) => void
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  async function reconcile() {
    await reconcilePullRequestChange(onChanged, 'Watch changed', setSyncError)
  }
  async function changeWatch() {
    setBusy(true)
    try {
      const enabled = !Boolean(pr.auto_review_watch)
      const result = await api<{ watched: boolean; queued: boolean; automation_enabled: boolean }>(
        `/api/pulls/${pr.repo_id}/${pr.number}/review-watch`,
        { method: 'POST', body: JSON.stringify({ enabled }) },
      )
      await reconcile()
      if (!result.watched) toast.success(`Stopped watching #${pr.number} for new commits`)
      else if (result.queued) toast.success(`Watching #${pr.number}; its current head was queued for review`)
      else if (!result.automation_enabled) toast.warning(`Watching #${pr.number}; automatic review is currently disabled globally`)
      else toast.success(`Watching #${pr.number} for new commits`)
    } catch (error) {
      setSyncError((error as Error).message)
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Agent review status" className="flex min-w-0 items-center justify-between gap-2 lg:justify-start">
      <div className="flex min-w-0 items-center gap-2">
        <Bot className="size-3.5 shrink-0 text-blue-400" />
        <div className="min-w-0">
          {pr.latest_agent_review_id ? (
            <button
              type="button"
              onClick={() => onRun(pr.latest_agent_review_id!)}
              className="block max-w-full truncate text-left text-[11px] font-semibold text-blue-400 hover:underline"
            >
              Review #{pr.latest_agent_review_id} · {age(pr.latest_agent_review_finished_at || pr.latest_agent_review_created_at)}
            </button>
          ) : (
            <span className="block truncate text-[11px] text-muted-foreground">No review</span>
          )}
        </div>
      </div>
      <AgentReviewStatusControls
        compact
        currentHeadSha={pr.head_sha}
        reviewedHeadSha={pr.latest_agent_review_head_sha}
        reviewId={pr.latest_agent_review_id}
        automatic={Boolean(pr.latest_agent_review_automatic)}
        watching={Boolean(pr.auto_review_watch)}
        busy={busy}
        onWatchChange={() => void changeWatch()}
      />
      {syncError ? (
        <div role="alert" className="flex items-center gap-1.5 text-[11px] text-red-300">
          <AlertTriangle className="size-3 shrink-0" />
          <span className="min-w-0 flex-1">Refresh failed</span>
          <Button variant="ghost" size="icon-xs" aria-label="Retry queue refresh" onClick={() => void reconcile()}>
            <RefreshCw />
          </Button>
        </div>
      ) : null}
    </section>
  )
}

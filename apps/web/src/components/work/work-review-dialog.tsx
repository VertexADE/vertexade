import { useEffect, useState } from 'react'
import { FileSearch, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Label } from '@vertexade/ui/components/ui/label'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { reviewLaunchFeedback, type ReviewLaunchError } from './review-launch-feedback'

function reviewableWorktreeJobs(item: WorkItem) {
  return item.threads.filter(
    (job) =>
      !['review', 'work_review', 'stack_analysis', 'azure_planning'].includes(job.kind) && !['starting', 'running'].includes(job.status),
  )
}

function reviewStartedToast(jobCount: number, errors: ReviewLaunchError[]) {
  const feedback = reviewLaunchFeedback(jobCount, errors)
  const options = feedback.description ? { description: feedback.description, duration: 12_000 } : undefined
  toast[feedback.kind](feedback.title, options)
}

function reviewSubmitLabel(busy: boolean, count: number) {
  if (busy) return 'Starting reviews…'
  return count === 1 ? 'Review 1 worktree' : `Review ${count} worktrees`
}

function ReviewSubmitIcon({ busy }: { busy: boolean }) {
  return busy ? <Loader2 className="animate-spin" /> : <FileSearch />
}

function ReviewSubmitButton({ busy, count, onClick }: { busy: boolean; count: number; onClick: () => void }) {
  return (
    <Button className="h-11 sm:h-8" disabled={busy || !count} onClick={onClick}>
      <ReviewSubmitIcon busy={busy} />
      {reviewSubmitLabel(busy, count)}
    </Button>
  )
}

export function UpfrontReviewDialog({
  item,
  open,
  onOpenChange,
  onStarted,
}: {
  item: WorkItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onStarted: (jobId?: number) => void
}) {
  const [selected, setSelected] = useState<number[]>([])
  const [focus, setFocus] = useState('')
  const [busy, setBusy] = useState(false)
  const worktrees = reviewableWorktreeJobs(item)
  useEffect(() => {
    if (!open) return
    setFocus('')
    setSelected(
      reviewableWorktreeJobs(item)
        .slice(0, 8)
        .map((job) => job.id),
    )
  }, [item.id, item.threads, open])

  async function submit() {
    setBusy(true)
    try {
      const result = await api<{
        threads: Array<{ id: number; full_name: string }>
        errors: Array<{ repository: string; error: string }>
      }>(`/api/work-items/${item.id}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ source_job_ids: selected, focus }),
      })
      reviewStartedToast(result.threads.length, result.errors)
      onOpenChange(false)
      onStarted(result.threads[0]?.id)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="size-5 text-cyan-400" />
            Start review threads
          </DialogTitle>
          <DialogDescription>
            {item.key} · each selection starts a new review thread against a copy of that implementation worktree. The source worktree is
            not changed and linked pull requests are not used.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Choose stopped worktrees to review</p>
            {worktrees.map((job) => (
              <Label key={job.id} className="flex min-h-11 items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  checked={selected.includes(job.id)}
                  onCheckedChange={(value) =>
                    setSelected((current) =>
                      value ? [...new Set([...current, job.id])].slice(0, 8) : current.filter((id) => id !== job.id),
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-xs">
                    {job.full_name} · work thread #{job.id}
                  </strong>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {job.branch_name || 'Detached worktree'} · {job.status}
                  </small>
                </span>
              </Label>
            ))}
            {!worktrees.length && (
              <div className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">
                No stopped work thread is available yet. Start a work thread and wait for it to stop before starting a review thread.
              </div>
            )}
          </div>
          <Label className="flex-col items-stretch gap-1.5">
            Optional review focus
            <Textarea
              value={focus}
              maxLength={10_000}
              onChange={(event) => setFocus(event.target.value)}
              className="min-h-24"
              placeholder="For example: focus on secret handling, migration safety, responsive behavior, or test gaps…"
            />
          </Label>
          <AgentOptionsPicker />
          <div className="flex items-start gap-2 rounded-lg border border-cyan-500/25 bg-cyan-500/[.05] p-3 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-cyan-400" />
            <span>
              Review thread: committed, staged, unstaged, and untracked changes are inspected read-only in the existing shared worktree.
              Supporting providers use an ephemeral session while VertexADE retains the complete report. Use a work thread when you want the
              agent to implement changes.
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button className="h-11 sm:h-8" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <ReviewSubmitButton busy={busy} count={selected.length} onClick={() => void submit()} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2, RotateCcw, ShieldCheck, Trash2, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { WorkDeletionPreview, WorkDeletionResult, WorkItem } from '@vertexade/ui/lib/dashboard-types'

function deletionSuccessMessage(result: WorkDeletionResult) {
  const noun = result.threads_deleted === 1 ? 'thread' : 'threads'
  const retained = result.logs_retained + result.provider_threads_retained
  return `${result.work_item_key} and ${result.threads_deleted} ${noun} deleted; ${retained ? `${retained} external artifact${retained === 1 ? '' : 's'} and ` : ''}pull requests preserved`
}

function deletionFailureTarget(result: WorkDeletionResult) {
  return result.errors[0]?.target || 'retry the failed items'
}

function deleteButtonContent(busy: boolean, retrying: boolean) {
  return busy ? (
    <>
      <Loader2 className="animate-spin" />
      {retrying ? 'Retrying cleanup…' : 'Deleting local work…'}
    </>
  ) : (
    <>
      {retrying ? <RotateCcw /> : <Trash2 />}
      {retrying ? 'Retry cleanup' : 'Delete Work permanently'}
    </>
  )
}

export function DeleteWorkDialog({
  item,
  open,
  onOpenChange,
  onDeleted,
  onRetry,
}: {
  item: WorkItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
  onRetry: () => void
}) {
  const [preview, setPreview] = useState<WorkDeletionPreview | null>(null)
  const [cleanupResult, setCleanupResult] = useState<WorkDeletionResult | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) {
      setPreview(null)
      setCleanupResult(null)
      return
    }
    void api<WorkDeletionPreview>(`/api/work-items/${item.id}/delete-preview`)
      .then(setPreview)
      .catch((error) => {
        toast.error((error as Error).message)
        onOpenChange(false)
      })
  }, [item.id, onOpenChange, open])
  async function remove() {
    setBusy(true)
    try {
      const result = await api<WorkDeletionResult>(`/api/work-items/${item.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmed: true }),
      })
      if (!result.deleted) {
        setCleanupResult(result)
        toast.error(`Cleanup is incomplete: ${deletionFailureTarget(result)}`)
        setPreview(await api<WorkDeletionPreview>(`/api/work-items/${item.id}/delete-preview`))
        onRetry()
        return
      }
      toast.success(deletionSuccessMessage(result))
      setCleanupResult(null)
      onOpenChange(false)
      onDeleted()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function detach(artifactId: number) {
    setBusy(true)
    try {
      await api(`/api/work-cleanup/artifacts/${artifactId}`, {
        method: 'DELETE',
        body: JSON.stringify({ work_item_key: item.key }),
      })
      toast.success('Cleanup ownership detached; the original artifact was left untouched')
      setCleanupResult(null)
      setPreview(await api<WorkDeletionPreview>(`/api/work-items/${item.id}/delete-preview`))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value)
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pr-6 leading-snug text-red-400">
            <Trash2 className="mt-0.5 size-5 shrink-0" />
            Delete {item.key} permanently?
          </DialogTitle>
          <DialogDescription>
            Review the local impact once, then delete. Pull requests, repositories, and remote branches stay intact.
          </DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="space-y-4">
            <DeleteImpact preview={preview} />
            {cleanupResult && <PendingCleanup result={cleanupResult} busy={busy} onDetach={(id) => void detach(id)} />}
          </div>
        ) : (
          <div className="grid min-h-40 place-items-center text-xs text-muted-foreground">
            <span>
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              Calculating deletion impact…
            </span>
          </div>
        )}
        <DialogFooter>
          <Button className="h-11 sm:h-8" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="h-11 sm:h-8" variant="destructive" disabled={!preview || busy} onClick={remove}>
            {deleteButtonContent(busy, Boolean(cleanupResult))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PendingCleanup({ result, busy, onDetach }: { result: WorkDeletionResult; busy: boolean; onDetach(artifactId: number): void }) {
  const artifacts = result.cleanup_artifacts || []
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[.06] p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <strong className="block text-xs text-amber-200">Cleanup is safely paused</strong>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Ownership is preserved. Retry transient failures, or detach a blocked path only if it should remain untouched.
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {artifacts.map((artifact) => (
          <div key={artifact.id} className="flex min-w-0 items-start justify-between gap-3 rounded border bg-background/40 p-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-medium">{artifact.kind.replace('_', ' ')}</span>
                <Badge variant="outline">{artifact.state === 'retrying' ? 'Retry scheduled' : artifact.state}</Badge>
                {artifact.attempts > 0 && <span className="text-muted-foreground">{artifact.attempts} attempts</span>}
              </div>
              <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{artifact.target}</p>
              {artifact.error && <p className="mt-1 text-[10px] text-amber-200/80">{artifact.error}</p>}
            </div>
            {artifact.state === 'blocked' && (
              <Button variant="outline" size="xs" disabled={busy} onClick={() => onDetach(artifact.id)}>
                <Unlink />
                Detach
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function activeThreadDetail(count: number) {
  return count ? `${count} active; will stop` : 'Agent history'
}

function retainedDetail(count: number, fallback: string) {
  return count ? `${count} retained` : fallback
}

function DeleteImpact({ preview }: { preview: WorkDeletionPreview }) {
  const retainedWorktrees = preview.worktrees.filter((entry) => !entry.removable).length
  const retainedBranches = preview.local_branches.filter((entry) => !entry.removable).length
  const metrics: Array<[string, number, string]> = [
    ['Threads', preview.threads.total, activeThreadDetail(preview.threads.active)],
    ['Worktrees', preview.worktrees.length - retainedWorktrees, retainedDetail(retainedWorktrees, 'Local checkouts')],
    ['Local branches', preview.local_branches.length - retainedBranches, retainedDetail(retainedBranches, 'Remote stays intact')],
    ['Logs', preview.logs, 'Local thread output'],
    ...(preview.logs_retained
      ? ([['Retained logs', preview.logs_retained, 'Outside this dashboard data root']] as Array<[string, number, string]>)
      : []),
    ['Memory', preview.memory_file ? 1 : 0, 'Shared agent context'],
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {metrics.map(([label, value, detail]) => (
          <ImpactMetric key={label} label={label} value={value} detail={detail} />
        ))}
      </div>
      <PreservedPullRequests pullRequests={preview.preserved_pull_requests} />
      <RetainedCleanupWarning count={retainedWorktrees + retainedBranches} />
    </div>
  )
}

function ImpactMetric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-lg border bg-muted/25 p-3">
      <strong className="block font-mono text-lg">{value}</strong>
      <span className="block text-[11px] font-medium">{label}</span>
      <small className="text-[11px] text-muted-foreground">{detail}</small>
    </div>
  )
}

function RetainedCleanupWarning({ count }: { count: number }) {
  if (!count) return null
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[.05] p-3 text-[11px] text-amber-200">
      <AlertTriangle className="mr-2 inline size-4" />
      Shared or unmanaged worktrees and local branches stay in place.
    </div>
  )
}

function PreservedPullRequests({ pullRequests }: { pullRequests: WorkDeletionPreview['preserved_pull_requests'] }) {
  return (
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[.05] p-3">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
        <div>
          <strong className="block text-xs text-emerald-300">Preserved</strong>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Repository entries, remote branches, cached PR records, and GitHub pull requests are not deleted.
          </p>
        </div>
      </div>
      {pullRequests.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pullRequests.map((pullRequest) =>
            pullRequest.url ? (
              <a
                key={pullRequest.url}
                href={pullRequest.url}
                target="_blank"
                rel="noreferrer"
                className="rounded border px-2 py-1 text-[11px] hover:bg-accent"
              >
                {pullRequest.label}
                <ExternalLink className="ml-1 inline size-3" />
              </a>
            ) : (
              <Badge key={pullRequest.label} variant="outline">
                {pullRequest.label}
              </Badge>
            ),
          )}
        </div>
      )}
    </div>
  )
}

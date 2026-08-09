import { useState } from 'react'
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { CleanupWorktreeRemovalDialog } from '@vertexade/ui/components/cleanup-worktrees/removal-dialog'
import { CleanupWorktreeRow } from '@vertexade/ui/components/cleanup-worktrees/cleanup-worktree-row'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { CleanupWorktree, MergedWorktreeCleanupResult } from '@vertexade/ui/lib/dashboard-types'

export function CleanupWorktrees({ worktrees }: { worktrees: CleanupWorktree[] }) {
  const [removing, setRemoving] = useState<number | null>(null)
  const [bulkRemoving, setBulkRemoving] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<CleanupWorktree | null>(null)
  const [removedPaths, setRemovedPaths] = useState<Set<string>>(() => new Set())
  const visibleWorktrees = worktrees.filter((item) => !removedPaths.has(item.worktree_path))

  async function remove(item: CleanupWorktree, removeRunHistory = false) {
    setRemoving(item.job_id)
    try {
      await api(`/api/cleanup-worktrees/${item.job_id}/remove`, {
        method: 'POST',
        body: JSON.stringify({ remove_thread_history: removeRunHistory }),
      })
      setRemovedPaths((current) => new Set(current).add(item.worktree_path))
      setPendingRemoval(null)
      toast.success(`Removed worktree for #${item.pr_number}${removeRunHistory ? ' and its run history' : ''}`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRemoving(null)
    }
  }

  async function removeMerged() {
    setBulkRemoving(true)
    try {
      const result = await api<MergedWorktreeCleanupResult>('/api/worktrees/cleanup-merged', {
        method: 'POST',
      })
      setRemovedPaths((current) => new Set([...current, ...result.paths]))
      if (result.removed) toast.success(`Removed ${result.removed} merged pull-request worktree${result.removed === 1 ? '' : 's'}`)
      if (result.errors.length) toast.error(`${result.errors.length} worktree${result.errors.length === 1 ? '' : 's'} still need attention`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBulkRemoving(false)
    }
  }

  if (!visibleWorktrees.length)
    return (
      <Card size="sm" variant="subtle">
        <CardContent className="flex items-center gap-2.5">
          <CheckCircle2 className="size-4 shrink-0 text-success" />
          <div className="min-w-0">
            <CardTitle className="text-sm">Local worktrees are tidy</CardTitle>
            <CardDescription className="hidden sm:block">No closed pull-request worktrees need cleanup.</CardDescription>
          </div>
        </CardContent>
      </Card>
    )

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="flex-row items-center justify-between border-b p-4">
          <div>
            <CardTitle className="text-sm">Local worktree cleanup</CardTitle>
            <CardDescription>Remove isolated worktrees left behind by closed or merged pull requests.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {visibleWorktrees.some((item) => item.pr_merged_at) && (
              <Button size="sm" variant="outline" disabled={bulkRemoving || removing !== null} onClick={() => void removeMerged()}>
                {bulkRemoving ? <Loader2 className="animate-spin" /> : <Sparkles />}Clean merged
              </Button>
            )}
            <Badge
              variant={visibleWorktrees.length ? 'outline' : 'secondary'}
              className={visibleWorktrees.length ? 'border-warning/40 text-warning' : ''}
            >
              {visibleWorktrees.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {visibleWorktrees.map((item) => (
            <CleanupWorktreeRow
              key={`${item.job_id}:${item.worktree_path}`}
              item={item}
              busy={removing !== null || bulkRemoving}
              removing={removing === item.job_id}
              onRemove={() => void remove(item)}
              onRemoveWithHistory={() => setPendingRemoval(item)}
            />
          ))}
        </CardContent>
      </Card>

      <CleanupWorktreeRemovalDialog
        item={pendingRemoval}
        busy={removing !== null}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => pendingRemoval && void remove(pendingRemoval, true)}
      />
    </>
  )
}

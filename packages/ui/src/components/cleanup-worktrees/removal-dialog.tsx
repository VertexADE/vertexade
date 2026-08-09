import { History, Trash2 } from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import type { CleanupWorktree } from '@vertexade/ui/lib/dashboard-types'

type Props = {
  item: CleanupWorktree | null
  busy: boolean
  onCancel(): void
  onConfirm(): void
}

export function CleanupWorktreeRemovalDialog({ item, busy, onCancel, onConfirm }: Props) {
  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Remove local worktree?</DialogTitle>
          <DialogDescription>
            This removes the isolated checkout and permanently deletes its associated run history. Existing pull requests are preserved.
          </DialogDescription>
        </DialogHeader>
        <div className="break-all rounded-md border bg-muted/30 p-3 font-mono text-xs text-muted-foreground">{item?.worktree_path}</div>
        <div className="flex items-start gap-3 rounded-md border p-3">
          <History className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            <strong className="block text-sm">Run history will be removed</strong>
            <small className="text-xs leading-relaxed text-muted-foreground">
              Permanently deletes {item?.run_count || 0} associated run
              {item?.run_count === 1 ? '' : 's'} and logs from the dashboard.
            </small>
          </span>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!item || busy} onClick={onConfirm}>
            <Trash2 />
            {busy ? 'Removing…' : 'Remove worktree and history'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

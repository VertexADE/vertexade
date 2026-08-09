import { History, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { CleanupWorktree } from '@vertexade/ui/lib/dashboard-types'

type Props = {
  item: CleanupWorktree
  busy: boolean
  removing: boolean
  onRemove(): void
  onRemoveWithHistory(): void
}

export function CleanupWorktreeRow({ item, busy, removing, onRemove, onRemoveWithHistory }: Props) {
  return (
    <article className="border-b p-4 last:border-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-primary">
            {item.full_name} · #{item.pr_number}
          </p>
          <strong className="mt-1 block truncate text-sm">{item.pr_title || 'Closed pull request'}</strong>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.pr_merged_at ? 'Merged' : 'Closed'} {age(item.pr_closed_at)} · {item.run_count} run
            {item.run_count === 1 ? '' : 's'}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={item.worktree_path}>
            {item.worktree_path}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" disabled={busy} className="text-destructive" onClick={onRemove}>
            {removing ? <Loader2 className="animate-spin" /> : <Trash2 />}Remove now
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRemoveWithHistory}>
            <History />
            With history
          </Button>
        </div>
      </div>
    </article>
  )
}

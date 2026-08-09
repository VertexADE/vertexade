import { Link } from '@tanstack/react-router'
import { Archive, ArrowRightLeft, Check, ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react'
import type { WorkItem, WorkState } from '@vertexade/ui/lib/dashboard-types'
import { displayBackendKey } from '@vertexade/ui/lib/backend-registry'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { workStateLabels, workStateOrder } from '../../lib/work-board-stage'

export function WorkCardMenu({
  item,
  busy = false,
  onMove,
  onArchive,
  onDelete,
}: {
  item: WorkItem
  busy?: boolean
  onMove?: (item: WorkItem, state: WorkState) => void
  onArchive: (item: WorkItem) => void
  onDelete: (item: WorkItem) => void
}) {
  const key = displayBackendKey(item, item.key)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute right-1.5 top-1.5 z-10 grid size-7 place-items-center rounded-md text-muted-foreground opacity-80 transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          aria-label={`Actions for ${key}`}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onPointerDown={(event) => event.stopPropagation()}>
        <DropdownMenuLabel>{key} actions</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/work/$workKey" params={{ workKey: item.key }}>
            <ExternalLink /> Open Work details
          </Link>
        </DropdownMenuItem>
        {onMove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 text-xs">
              <ArrowRightLeft className="size-3.5" /> Move to
            </DropdownMenuLabel>
            {workStateOrder.map((state) => (
              <DropdownMenuItem key={state} disabled={busy || state === item.state} onSelect={() => onMove(item, state)}>
                {state === item.state ? <Check /> : <span className="size-4" />}
                {workStateLabels[state]}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onSelect={() => onArchive(item)}>
          <Archive /> Archive Work
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => onDelete(item)}>
          <Trash2 /> Delete Work permanently
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

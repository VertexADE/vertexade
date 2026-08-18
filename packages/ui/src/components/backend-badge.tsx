import type { BackendAttributed } from '@vertexade/ui/lib/backend-registry'
import { cn } from '@vertexade/ui/lib/utils'

export function BackendBadge({
  source,
  className,
  role = 'location',
  nameOnly = false,
}: {
  source: BackendAttributed
  className?: string
  role?: 'source' | 'execution' | 'storage' | 'location'
  nameOnly?: boolean
}) {
  if (!source.backend_id || !source.backend_name) return null
  const connected = source.backend_connected !== false
  return (
    <span
      data-backend-id={source.backend_id}
      title={`${{ source: 'Source data', execution: 'Agent execution and run data', storage: 'Stored data', location: 'Server' }[role]}: ${source.backend_name} · ${connected ? 'connected' : 'offline, showing cached data'}`}
      className={cn(
        'inline-flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-muted/35 px-1.5 text-[10px] font-medium text-muted-foreground',
        !connected && 'border-warning/35 text-warning',
        className,
      )}
    >
      {nameOnly && <span className={cn('size-1.5 shrink-0 rounded-full', connected ? 'bg-success' : 'bg-warning')} />}
      <span className="truncate">
        {nameOnly
          ? source.backend_name
          : `${{ source: 'Source', execution: 'Runs + data', storage: 'Stored', location: 'Server' }[role]} · ${source.backend_name}`}
      </span>
      {!nameOnly && <span className={cn('size-1.5 shrink-0 rounded-full', connected ? 'bg-success' : 'bg-warning')} />}
    </span>
  )
}

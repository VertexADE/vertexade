import { Link } from '@tanstack/react-router'
import { ArrowRight, Play } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { BackendBadge } from '@vertexade/ui/components/backend-badge'
import { Button } from '@vertexade/ui/components/ui/button'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { displayBackendKey } from '@vertexade/ui/lib/backend-registry'
import { cn } from '@vertexade/ui/lib/utils'
import { focusItemDisplay } from './focus-item-presentation'

export function FocusUpNext({
  items,
  onDelegate,
  embedded = false,
}: {
  items: WorkItem[]
  onDelegate: (item: WorkItem) => void
  embedded?: boolean
}) {
  if (!items.length) return null

  return (
    <section
      aria-labelledby="focus-up-next"
      className={cn('overflow-hidden bg-card/10', !embedded && 'rounded-lg border border-border/55')}
    >
      <header className={cn('border-b px-3 py-2', embedded && 'px-0')}>
        <div className="flex items-center gap-2">
          <h2 id="focus-up-next" className="text-sm font-semibold">
            Later
          </h2>
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
            {items.length}
          </Badge>
        </div>
        <p className="sr-only">Ready when current work clears.</p>
      </header>
      <div className="divide-y">
        {items.slice(0, 3).map((item) => (
          <FocusUpNextItem key={item.id} item={item} onDelegate={() => onDelegate(item)} />
        ))}
      </div>
      <footer className={cn('border-t px-3 py-2', embedded && 'px-0')}>
        <Button asChild variant="ghost" size="xs" className="w-full justify-between">
          <Link to="/work">
            Open work queue
            <ArrowRight />
          </Link>
        </Button>
      </footer>
    </section>
  )
}

function FocusUpNextItem({ item, onDelegate }: { item: WorkItem; onDelegate: () => void }) {
  const display = focusItemDisplay(item)
  return (
    <article className="flex min-w-0 items-center gap-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-[11px] text-blue-400">{displayBackendKey(item, item.key)}</span>
          <BackendBadge source={item} />
        </span>
        <Link
          to="/work/$workKey"
          params={{ workKey: item.key }}
          className="mt-1 block line-clamp-2 text-sm font-medium leading-snug hover:text-primary"
        >
          {display.title}
        </Link>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{display.repository || 'Workspace work'}</p>
      </div>
      <Button type="button" variant="outline" size="xs" className="shrink-0" onClick={onDelegate}>
        <Play />
        Start
      </Button>
    </article>
  )
}

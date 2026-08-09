import { useEffect, useId, useState } from 'react'
import { ChevronDown, Workflow } from 'lucide-react'
import { cn } from '@vertexade/ui/lib/utils'

export function AdvancedRecipeOptions({
  actionCount,
  checkCount,
  children,
}: {
  actionCount: number
  checkCount: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(actionCount > 0 || checkCount > 0)
  const contentId = useId()
  useEffect(() => {
    if (actionCount || checkCount) setOpen(true)
  }, [actionCount, checkCount])

  return (
    <section className="overflow-hidden rounded-lg border bg-muted/[.08]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        className="flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/20"
        onClick={() => setOpen((current) => !current)}
      >
        <Workflow className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <strong className="block text-xs">Optional publishing and checks</strong>
          <span className="block truncate text-[11px] text-muted-foreground">{advancedRecipeSummary(actionCount, checkCount)}</span>
        </span>
        <span className="text-[10px] text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={contentId} className="space-y-4 border-t p-3">
          {children}
        </div>
      )}
    </section>
  )
}

export function advancedRecipeSummary(actionCount: number, checkCount: number) {
  return [
    actionCount ? `${actionCount} publishing action${actionCount === 1 ? '' : 's'}` : 'No publishing',
    checkCount ? `${checkCount} extra check${checkCount === 1 ? '' : 's'}` : 'no extra checks',
  ].join(' · ')
}

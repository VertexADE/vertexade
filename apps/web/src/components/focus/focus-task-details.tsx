import { Link } from '@tanstack/react-router'
import { Bot, Check, CircleAlert, ExternalLink } from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import type { AcceptanceCheck } from './focus-task-model'

type FocusTaskDetailsProps = {
  item: WorkItem
  checks: AcceptanceCheck[]
  blocker: string | null
  onDelegate: () => void
}

export function FocusTaskDetails({ item, checks, blocker, onDelegate }: FocusTaskDetailsProps) {
  const summary = taskSummary(item.description)

  return (
    <div className="border-t bg-card/[.12] px-4 py-3 sm:ml-[4.8rem]">
      {blocker && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[.05] px-3 py-2 text-[11px] text-amber-200">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{blocker}</span>
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          {summary && <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">{summary}</p>}
          <strong className="text-[11px] font-medium uppercase tracking-[.12em] text-muted-foreground">Acceptance checklist</strong>
          {checks.length ? (
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {checks.map((check) => (
                <li key={check.label} className="flex min-w-0 items-start gap-2 text-[11px]">
                  <span
                    className={cn(
                      'mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-sm border',
                      check.complete && 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
                    )}
                  >
                    {check.complete && <Check className="size-2.5" />}
                  </span>
                  <span className={cn(check.complete && 'text-muted-foreground line-through')}>{check.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              No acceptance criteria recorded yet. Add them in Work details before delegating complex changes.
            </p>
          )}
        </div>
        <div className="flex items-end gap-2 lg:flex-col lg:items-stretch lg:justify-end">
          <Button type="button" size="sm" onClick={onDelegate}>
            <Bot />
            Delegate to agent
          </Button>
          <Button asChild type="button" size="sm" variant="outline">
            <Link to="/work/$workKey" params={{ workKey: item.key }}>
              Open work
              <ExternalLink />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

function taskSummary(description: string) {
  return description
    .split('\n')
    .filter((line) => line.trim() && !/^\s*[-*]\s+\[[ xX]\]/.test(line))
    .join(' ')
    .replace(/[#*_`]/g, '')
    .trim()
    .slice(0, 320)
}

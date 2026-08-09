import { useMemo, useState } from 'react'
import type { AutomationFlowRun, AutomationImprovementItem } from '@vertexade/platform-contracts'
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Label } from '@vertexade/ui/components/ui/label'
import { cn } from '@vertexade/ui/lib/utils'

const priorityTone: Record<AutomationImprovementItem['priority'], string> = {
  P0: 'border-red-500/40 text-red-400',
  P1: 'border-orange-500/40 text-orange-400',
  P2: 'border-amber-500/40 text-amber-400',
  P3: 'border-blue-500/40 text-blue-400',
}

function ImprovementItem({
  item,
  checked,
  onCheckedChange,
}: {
  item: AutomationImprovementItem
  checked: boolean
  onCheckedChange(checked: boolean): void
}) {
  return (
    <Label
      className={cn(
        'flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors',
        checked && 'border-violet-500/35 bg-violet-500/[.055]',
      )}
    >
      <Checkbox className="mt-0.5 shrink-0" checked={checked} onCheckedChange={(value) => onCheckedChange(Boolean(value))} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <strong className="min-w-0 break-words text-xs leading-snug">{item.title}</strong>
          <Badge variant="outline" className={cn('shrink-0 text-xs', priorityTone[item.priority])}>
            {item.priority}
          </Badge>
        </span>
        <small className="mt-1 block break-words text-xs leading-relaxed text-muted-foreground">{item.description}</small>
        {item.files.length > 0 && (
          <small className="mt-1 block truncate font-mono text-xs text-cyan-400/80">{item.files.join(' · ')}</small>
        )}
      </span>
    </Label>
  )
}

export function AutomationImprovementApproval({
  run,
  busy,
  onResolve,
}: {
  run: AutomationFlowRun
  busy: boolean
  onResolve(selectedIds: string[]): void
}) {
  const availableIds = useMemo(() => run.improvementItems.map((item) => item.id), [run.improvementItems])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(availableIds))
  const selectedIds = availableIds.filter((id) => selected.has(id))

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <section className="mt-2 space-y-2 rounded-xl border border-violet-500/30 bg-violet-500/[.035] p-2.5">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-violet-400" />
        <div className="min-w-0 flex-1">
          <strong className="block text-xs text-violet-200">Approval required</strong>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Review the proposed plan. Only checked items will be sent back to this same run for implementation.
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0 text-xs">
          {selectedIds.length}/{availableIds.length}
        </Badge>
      </div>
      <div className="space-y-1.5">
        {run.improvementItems.map((item) => (
          <ImprovementItem
            key={item.id}
            item={item}
            checked={selected.has(item.id)}
            onCheckedChange={(checked) => toggle(item.id, checked)}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onResolve([])}>
          Skip all
        </Button>
        <Button type="button" size="sm" disabled={busy || !selectedIds.length} onClick={() => onResolve(selectedIds)}>
          {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}Apply {selectedIds.length || ''} selected
        </Button>
      </div>
    </section>
  )
}

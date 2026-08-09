import { Check, CircleAlert, Clipboard, Copy, Terminal, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { cn } from '@vertexade/ui/lib/utils'

export type SetupTool = {
  id: string
  name: string
  ready: boolean
  required: boolean
  detail: string
  install: string
}

export function OperationalMetric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={cn('rounded-lg border bg-background p-2.5', warning && 'border-amber-500/30 bg-amber-500/[.04]')}>
      <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
      <strong className={cn('mt-1 block truncate font-mono text-[11px]', warning && 'text-amber-400')} title={value}>
        {value}
      </strong>
    </div>
  )
}

export function GuideCard({
  number,
  icon: Icon,
  title,
  description,
  ready,
  children,
}: {
  number: string
  icon: typeof Wrench
  title: string
  description: string
  ready?: boolean
  children: React.ReactNode
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg border bg-muted/30 text-xs',
              ready && 'border-emerald-500/35 bg-emerald-500/10 text-emerald-400',
            )}
          >
            {ready ? <Check className="size-4" /> : number}
          </span>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icon className="size-4" />
              {title}
            </CardTitle>
            <CardDescription className="mt-1 text-xs">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">{children}</CardContent>
    </Card>
  )
}

export function StatusList({ items }: { items: SetupTool[] }) {
  return (
    <div className="divide-y rounded-lg border">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-2 p-3">
          <StatusDot ready={item.ready} />
          <div className="min-w-0">
            <strong className="block text-xs">{item.name}</strong>
            <span className="block break-words text-xs text-muted-foreground">{item.ready ? item.detail : item.install}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function StatusLine({ ready, title, detail }: { ready: boolean; title: string; detail: string }) {
  return (
    <div
      className={cn(
        'flex min-w-0 gap-2 rounded-lg border p-2.5',
        ready ? 'border-emerald-500/30 bg-emerald-500/[.04]' : 'border-amber-500/30 bg-amber-500/[.04]',
      )}
    >
      <StatusDot ready={ready} />
      <div className="min-w-0">
        <strong className="block truncate text-xs">{title}</strong>
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground sm:text-xs">{detail}</p>
      </div>
    </div>
  )
}

export function StatusDot({ ready }: { ready: boolean }) {
  return ready ? (
    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
      <Check className="size-3" />
    </span>
  ) : (
    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-400">
      <CircleAlert className="size-3" />
    </span>
  )
}

export function Command({ value, label }: { value: string; label?: string }) {
  const copy = async () => {
    await navigator.clipboard.writeText(value)
    toast.success('Command copied')
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center gap-2 px-3 py-2">
        {label && <span className="hidden shrink-0 text-xs uppercase tracking-wide text-muted-foreground sm:inline">{label}</span>}
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-blue-300">{value}</code>
        <Button variant="ghost" size="icon-xs" onClick={() => void copy()} aria-label={`Copy ${label || 'setup'} command`}>
          <Clipboard />
        </Button>
      </div>
    </div>
  )
}

export function StepNumber({ value }: { value: string }) {
  return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 font-mono text-xs text-primary">{value}</span>
}

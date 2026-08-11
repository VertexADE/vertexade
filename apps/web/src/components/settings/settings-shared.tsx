import type { ComponentType, ReactNode } from 'react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Field, FieldDescription, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Separator } from '@vertexade/ui/components/ui/separator'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'

type SettingsIcon = ComponentType<{ className?: string }>

export type SettingsSummaryItem = {
  label: string
  value: string
  detail?: string
}

export function SettingsPageHeader({
  id,
  eyebrow,
  title,
  description,
  icon: Icon,
  badge,
  summary = [],
}: {
  id: string
  eyebrow: string
  title: string
  description: string
  icon: SettingsIcon
  badge?: string
  summary?: SettingsSummaryItem[]
}) {
  return (
    <header className="overflow-hidden rounded-xl border border-border/65 bg-card/70 shadow-sm">
      <div className="flex min-w-0 flex-col gap-5 bg-gradient-to-br from-primary/[.08] via-card/60 to-transparent p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/[.09] text-primary shadow-sm">
            <Icon className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-primary">{eyebrow}</p>
              {badge && <Badge variant="outline">{badge}</Badge>}
            </div>
            <h1 id={id} className="font-heading text-xl font-semibold tracking-[-.025em] sm:text-2xl">
              {title}
            </h1>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">{description}</p>
          </div>
        </div>
        {summary.length > 0 && (
          <dl className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-3 xl:min-w-[24rem]">
            {summary.map((item) => (
              <div key={item.label} className="min-w-0 bg-background/88 px-3 py-2.5">
                <dt className="text-[9px] font-medium uppercase tracking-[.12em] text-muted-foreground">{item.label}</dt>
                <dd className="mt-0.5 truncate text-xs font-semibold" title={item.value}>
                  {item.value}
                </dd>
                {item.detail && <dd className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.detail}</dd>}
              </div>
            ))}
          </dl>
        )}
      </div>
    </header>
  )
}

export function SettingsGroup({
  id,
  title,
  description,
  icon: Icon,
  badge,
  children,
}: {
  id: string
  title: string
  description: string
  icon: SettingsIcon
  badge?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="grid min-w-0 gap-3 lg:grid-cols-[11.5rem_minmax(0,1fr)] lg:gap-5">
      <header className="flex min-w-0 items-start gap-2.5 lg:pt-1">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 bg-muted/45 text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 id={id} className="text-sm font-semibold tracking-[-.01em]">
              {title}
            </h2>
            {badge && <Badge variant="secondary">{badge}</Badge>}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="flex min-w-0 flex-col gap-3 [&>[data-slot=card]]:shadow-sm">{children}</div>
    </section>
  )
}

export function SettingsSectionDivider() {
  return <Separator className="lg:ml-[13rem] lg:w-[calc(100%-13rem)]" />
}

export function RepositoryOwnerField({
  id,
  repositories,
  value,
  description,
  onChange,
}: {
  id: string
  repositories: Repository[]
  value: number | null
  description: string
  onChange(value: number | null): void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Repository owner</FieldLabel>
      <Select value={value ? String(value) : ''} onValueChange={(next) => onChange(next ? Number(next) : null)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Select repository" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {repositories.map((repository) => (
              <SelectItem key={repository.id} value={String(repository.id)}>
                {repository.full_name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription>{description}</FieldDescription>
    </Field>
  )
}

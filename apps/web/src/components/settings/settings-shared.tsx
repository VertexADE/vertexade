import type { ComponentType } from 'react'

export function SectionIntro({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string
  title: string
  icon: ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl border border-primary/10 bg-gradient-to-br from-primary/[.07] via-card/45 to-transparent p-3 sm:rounded-lg sm:p-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-primary/20 bg-primary/[.08] text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_5%,transparent)]">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 pt-0.5">
        <h2 id={id} className="text-base font-semibold tracking-[-.015em]">
          {title}
        </h2>
        <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}

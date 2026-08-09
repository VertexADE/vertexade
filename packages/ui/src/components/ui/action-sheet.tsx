import type { ComponentType, ReactNode, SVGProps } from 'react'

import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@vertexade/ui/components/ui/sheet'
import { cn } from '@vertexade/ui/lib/utils'

type ActionIcon = ComponentType<SVGProps<SVGSVGElement>>
const actionTone = { true: 'text-destructive hover:bg-destructive/10', false: '' }
const actionIconTone = { true: 'bg-destructive/10', false: 'bg-muted/60' }

export type ActionSheetAction = {
  id: string
  label: string
  auditAction?: string
  description?: string
  icon?: ActionIcon
  disabled?: boolean
  destructive?: boolean
  onSelect(): void
}

export type ActionSheetSection = {
  id: string
  label?: string
  actions: ActionSheetAction[]
}

function ActionSheetActionButton({ action }: { action: ActionSheetAction }) {
  const Icon = action.icon
  const destructive = String(Boolean(action.destructive)) as keyof typeof actionTone
  const button = (
    <button
      type="button"
      data-audit-action={action.auditAction}
      disabled={action.disabled}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors',
        'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-45',
        actionTone[destructive],
      )}
      onClick={action.onSelect}
    >
      {Icon && (
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', actionIconTone[destructive])}>
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <strong className="block text-sm font-medium">{action.label}</strong>
        {action.description && <small className="mt-0.5 block text-xs leading-snug text-muted-foreground">{action.description}</small>}
      </span>
    </button>
  )
  return action.disabled ? button : <SheetClose asChild>{button}</SheetClose>
}

export function ActionSheet({
  title,
  description,
  trigger,
  sections,
}: {
  title: string
  description?: string
  trigger: ReactNode
  sections: ActionSheetSection[]
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="gap-0 pb-[max(.75rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="text-left">
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="space-y-2 overflow-y-auto p-2">
          {sections
            .filter((section) => section.actions.length)
            .map((section) => (
              <section key={section.id} aria-label={section.label}>
                {section.label && <h3 className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">{section.label}</h3>}
                <div className="rounded-xl border bg-background/35 p-1">
                  {section.actions.map((action) => (
                    <ActionSheetActionButton key={action.id} action={action} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

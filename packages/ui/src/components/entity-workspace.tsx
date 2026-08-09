import { useState, type ComponentType, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Card } from '@vertexade/ui/components/ui/card'
import { PageActions, PageDescription, PageEyebrow, PageHeader, PageHeaderContent, PageTitle } from '@vertexade/ui/components/ui/layout'
import { SectionActions, SectionHeader, SectionHeaderContent, SectionTitle } from '@vertexade/ui/components/ui/section'
import { cn } from '@vertexade/ui/lib/utils'

function EntityIcon({ icon: Icon }: { icon?: ComponentType<{ className?: string }> }) {
  if (!Icon) return null
  return (
    <span
      data-slot="entity-icon"
      className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-primary/18 bg-primary/[.07] text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_4%,transparent)] sm:size-8"
    >
      <Icon className="size-4.5" />
    </span>
  )
}

function EntityBadges({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <div data-slot="entity-badges" className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
      {children}
    </div>
  )
}

function EntityMetadata({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <div
      data-slot="entity-metadata"
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 bg-muted/38 px-3 py-2.5 text-xs text-muted-foreground"
    >
      {children}
    </div>
  )
}

export function EntityHeader({
  eyebrow,
  title,
  description,
  badges,
  metadata,
  actions,
  backAction,
  icon: Icon,
  expandableTitle = false,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  badges?: ReactNode
  metadata?: ReactNode
  actions?: ReactNode
  backAction?: ReactNode
  icon?: ComponentType<{ className?: string }>
  expandableTitle?: boolean
  className?: string
}) {
  const [titleExpanded, setTitleExpanded] = useState(false)
  return (
    <Card data-slot="entity-header" className={cn('mb-4 min-w-0 gap-0 overflow-hidden py-0 backdrop-blur-sm', className)}>
      <PageHeader className="relative mb-0 items-start px-3 py-3 sm:px-4 sm:py-4">
        <PageHeaderContent className="flex-1 pr-16 sm:pr-0">
          {backAction && <div data-slot="entity-back">{backAction}</div>}
          <div className="flex min-w-0 items-start gap-3">
            <EntityIcon icon={Icon} />
            <div className="min-w-0 flex-1">
              {eyebrow && <PageEyebrow className="flex flex-wrap items-center gap-2">{eyebrow}</PageEyebrow>}
              <PageTitle
                data-slot="entity-title"
                data-audit-state={titleExpanded ? 'entity-title-expanded' : undefined}
                className={cn(
                  'max-w-5xl break-words text-lg leading-snug sm:text-2xl',
                  expandableTitle && !titleExpanded && 'line-clamp-2 sm:line-clamp-none',
                )}
              >
                {title}
              </PageTitle>
              {expandableTitle && (
                <button
                  type="button"
                  data-audit-action="entity.title.expand"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary sm:hidden"
                  aria-expanded={titleExpanded}
                  onClick={() => setTitleExpanded((expanded) => !expanded)}
                >
                  {titleExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  {titleExpanded ? 'Show less' : 'Read full title'}
                </button>
              )}
              {description && <PageDescription className="max-w-3xl">{description}</PageDescription>}
              <EntityBadges>{badges}</EntityBadges>
            </div>
          </div>
        </PageHeaderContent>
        {actions && (
          <PageActions className="absolute right-3 top-3 w-auto shrink-0 flex-wrap justify-end sm:static sm:self-start">
            {actions}
          </PageActions>
        )}
      </PageHeader>
      <EntityMetadata>{metadata}</EntityMetadata>
    </Card>
  )
}

export function EntityWorkspace({
  children,
  inspector,
  className,
  inspectorClassName,
}: {
  children: ReactNode
  inspector?: ReactNode
  className?: string
  inspectorClassName?: string
}) {
  return (
    <div data-slot="entity-workspace" className={cn('grid min-w-0 gap-4', inspector && 'xl:grid-cols-[minmax(0,1fr)_20rem]', className)}>
      <section data-slot="entity-workspace-content" className="min-w-0">
        {children}
      </section>
      {inspector && (
        <aside data-slot="entity-workspace-inspector" className={cn('min-w-0 space-y-3 xl:border-l xl:pl-4', inspectorClassName)}>
          {inspector}
        </aside>
      )}
    </div>
  )
}

export function EntityTabBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="entity-tab-bar"
      className={cn(
        'sticky top-12 z-20 -mx-3 overflow-x-auto overscroll-x-contain border-y border-border/70 bg-background/88 px-3 backdrop-blur-xl [mask-image:linear-gradient(to_right,#000_calc(100%-1rem),transparent)] [scrollbar-width:none] sm:static sm:mx-0 sm:border-x-0 sm:border-t-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none sm:[mask-image:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function EntityInspectorSection({
  eyebrow,
  title,
  actions,
  children,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card data-slot="entity-inspector-section" className={cn('min-w-0 gap-0 overflow-hidden py-0', className)}>
      <SectionHeader className="border-b p-3">
        <SectionHeaderContent>
          {eyebrow && <p className="font-mono text-xs uppercase tracking-[.12em] text-muted-foreground">{eyebrow}</p>}
          <SectionTitle className="mt-0.5">{title}</SectionTitle>
        </SectionHeaderContent>
        {actions && <SectionActions>{actions}</SectionActions>}
      </SectionHeader>
      {children}
    </Card>
  )
}

export function EntityActionDock({
  primary,
  secondary,
  overflow,
  className,
}: {
  primary: ReactNode
  secondary?: ReactNode
  overflow?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="entity-action-dock"
      className={cn(
        'sticky bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-20 -mx-3 mt-4 flex min-w-0 items-center justify-end gap-2 border-y border-border/75 bg-background/88 px-3 py-2 shadow-[0_-8px_24px_rgba(0,0,0,.1)] backdrop-blur-xl sm:bottom-0 sm:mx-0 sm:rounded-lg sm:border',
        className,
      )}
    >
      {overflow && <div className="mr-auto">{overflow}</div>}
      {secondary}
      {primary}
    </div>
  )
}

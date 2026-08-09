import type { ComponentType, ReactNode } from 'react'
import { Card } from '@vertexade/ui/components/ui/card'
import { PageActions, PageDescription, PageEyebrow, PageHeader, PageHeaderContent, PageTitle } from '@vertexade/ui/components/ui/layout'
import { Toolbar } from '@vertexade/ui/components/ui/toolbar'
import { cn } from '@vertexade/ui/lib/utils'

function OptionalIcon({ icon: Icon }: { icon?: ComponentType<{ className?: string }> }) {
  if (!Icon) return null
  return <Icon className="size-4 shrink-0 text-primary sm:size-5" />
}

export function WorkspacePage({
  children,
  className,
  ...props
}: {
  children: ReactNode
  className?: string
} & React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="workspace-page"
      className={cn('relative mx-auto w-full min-w-0 max-w-[96rem] px-3 py-4 sm:px-5 lg:px-7 lg:py-6 xl:px-8', className)}
      {...props}
    >
      {children}
    </main>
  )
}

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  icon?: ComponentType<{ className?: string }>
  actions?: ReactNode
  className?: string
}) {
  return (
    <PageHeader className={cn('flex-row items-start justify-between gap-5 pb-1', className)}>
      <PageHeaderContent>
        {eyebrow && <PageEyebrow className="items-center gap-1.5 sm:flex">{eyebrow}</PageEyebrow>}
        <PageTitle className="flex min-w-0 items-center gap-2">
          <OptionalIcon icon={Icon} />
          <span className="min-w-0 break-words">{title}</span>
        </PageTitle>
        {description && <PageDescription className="max-w-3xl">{description}</PageDescription>}
      </PageHeaderContent>
      {actions && <PageActions className="w-auto shrink-0 flex-wrap justify-end pt-0.5">{actions}</PageActions>}
    </PageHeader>
  )
}

export function WorkspaceToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <Toolbar className={cn('mb-4', className)}>{children}</Toolbar>
}

export function MasterDetail({
  list,
  detail,
  className,
  listClassName,
  detailClassName,
}: {
  list: ReactNode
  detail: ReactNode
  className?: string
  listClassName?: string
  detailClassName?: string
}) {
  return (
    <div className={cn('grid min-w-0 gap-4 lg:grid-cols-[minmax(19rem,23rem)_minmax(0,1fr)] xl:gap-5', className)}>
      <aside className={cn('min-w-0', listClassName)}>{list}</aside>
      <section className={cn('min-w-0', detailClassName)}>{detail}</section>
    </div>
  )
}

export function ResponsiveFieldGrid({
  children,
  className,
  minimum = '13rem',
}: {
  children: ReactNode
  className?: string
  minimum?: string
}) {
  return (
    <div
      className={cn('grid min-w-0 gap-3', className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minimum}), 1fr))` }}
    >
      {children}
    </div>
  )
}

export function ContentSurface({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn('min-w-0 gap-0 overflow-hidden py-0', className)}>{children}</Card>
}

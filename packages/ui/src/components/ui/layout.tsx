import * as React from 'react'

import { cn } from '@vertexade/ui/lib/utils'

function PageHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return (
    <header
      data-slot="page-header"
      className={cn('mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between', className)}
      {...props}
    />
  )
}

function PageHeaderContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="page-header-content" className={cn('min-w-0', className)} {...props} />
}

function PageEyebrow({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="page-eyebrow"
      className={cn('hidden text-[11px] font-medium tracking-[.015em] text-muted-foreground sm:block', className)}
      {...props}
    />
  )
}

function PageTitle({ className, ...props }: React.ComponentProps<'h1'>) {
  return (
    <h1
      data-slot="page-title"
      className={cn('font-heading text-xl font-semibold leading-tight tracking-[-.025em] text-balance sm:text-[1.55rem]', className)}
      {...props}
    />
  )
}

function PageDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="page-description"
      className={cn('mt-1 hidden max-w-3xl text-[13px] leading-relaxed text-muted-foreground sm:block', className)}
      {...props}
    />
  )
}

function PageActions({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="page-actions" className={cn('flex w-full items-center gap-2 sm:w-auto', className)} {...props} />
}

function StatGrid({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="stat-grid"
      className={cn('grid grid-cols-4 divide-x overflow-hidden rounded-lg border border-border/85 bg-card/85', className)}
      {...props}
    />
  )
}

function Stat({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="stat" className={cn('min-w-0 px-1.5 py-2 text-center sm:px-2.5', className)} {...props} />
}

function StatValue({ className, ...props }: React.ComponentProps<'strong'>) {
  return (
    <strong
      data-slot="stat-value"
      className={cn('block font-mono text-base leading-tight tabular-nums sm:text-lg', className)}
      {...props}
    />
  )
}

function StatLabel({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="stat-label"
      className={cn('mt-0.5 block line-clamp-2 text-[10px] leading-tight text-muted-foreground sm:text-[11px]', className)}
      {...props}
    />
  )
}

export { PageHeader, PageHeaderContent, PageEyebrow, PageTitle, PageDescription, PageActions, StatGrid, Stat, StatValue, StatLabel }

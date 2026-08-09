import * as React from 'react'

import { cn } from '@vertexade/ui/lib/utils'

function SectionHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return (
    <header
      data-slot="section-header"
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}
      {...props}
    />
  )
}

function SectionHeaderContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="section-header-content" className={cn('min-w-0', className)} {...props} />
}

function SectionTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 data-slot="section-title" className={cn('text-sm font-semibold leading-snug tracking-[-.01em]', className)} {...props} />
}

function SectionDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="section-description" className={cn('mt-1 text-xs leading-relaxed text-muted-foreground', className)} {...props} />
}

function SectionActions({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="section-actions" className={cn('flex w-full shrink-0 items-center gap-2 sm:w-auto', className)} {...props} />
}

function ActionBar({ className, align = 'end', ...props }: React.ComponentProps<'div'> & { align?: 'start' | 'between' | 'end' }) {
  return (
    <div
      data-slot="action-bar"
      data-align={align}
      className={cn(
        'flex flex-row flex-wrap items-center gap-2',
        'data-[align=start]:justify-start data-[align=between]:justify-between data-[align=end]:justify-end',
        className,
      )}
      {...props}
    />
  )
}

export { SectionHeader, SectionHeaderContent, SectionTitle, SectionDescription, SectionActions, ActionBar }

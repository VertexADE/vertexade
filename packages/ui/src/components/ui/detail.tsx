import * as React from 'react'

import { cn } from '@vertexade/ui/lib/utils'

function DetailGrid({ className, ...props }: React.ComponentProps<'dl'>) {
  return (
    <dl data-slot="detail-grid" className={cn('grid gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-2', className)} {...props} />
  )
}

function Detail({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="detail" className={cn('min-w-0 bg-card px-3 py-2.5', className)} {...props} />
}

function DetailLabel({ className, ...props }: React.ComponentProps<'dt'>) {
  return <dt data-slot="detail-label" className={cn('text-[10px] uppercase tracking-wide text-muted-foreground', className)} {...props} />
}

function DetailValue({ className, ...props }: React.ComponentProps<'dd'>) {
  return <dd data-slot="detail-value" className={cn('mt-1 min-w-0 break-words text-sm font-medium', className)} {...props} />
}

export { DetailGrid, Detail, DetailLabel, DetailValue }

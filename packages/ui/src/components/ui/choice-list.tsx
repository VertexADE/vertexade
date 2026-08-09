import * as React from 'react'

import { Label } from '@vertexade/ui/components/ui/label'
import { cn } from '@vertexade/ui/lib/utils'

function ChoiceList({ className, scrollable = false, ...props }: React.ComponentProps<'div'> & { scrollable?: boolean }) {
  return (
    <div
      data-slot="choice-list"
      data-scrollable={scrollable || undefined}
      role="group"
      className={cn(
        'divide-y overflow-hidden rounded-lg border',
        'data-[scrollable=true]:max-h-72 data-[scrollable=true]:overflow-y-auto',
        className,
      )}
      {...props}
    />
  )
}

function ChoiceItem({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="choice-item"
      className={cn(
        'flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-accent/50',
        'has-[[data-slot=checkbox]:disabled]:cursor-not-allowed has-[[data-slot=checkbox]:disabled]:opacity-60',
        className,
      )}
      {...props}
    />
  )
}

function ChoiceItemContent({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="choice-item-content" className={cn('min-w-0 flex-1', className)} {...props} />
}

function ChoiceItemTitle({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="choice-item-title" className={cn('block truncate text-xs font-medium', className)} {...props} />
}

function ChoiceItemDescription({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="choice-item-description"
      className={cn('mt-1 block text-[11px] leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  )
}

function ChoiceItemTrailing({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="choice-item-trailing" className={cn('ml-auto shrink-0', className)} {...props} />
}

export { ChoiceList, ChoiceItem, ChoiceItemContent, ChoiceItemTitle, ChoiceItemDescription, ChoiceItemTrailing }

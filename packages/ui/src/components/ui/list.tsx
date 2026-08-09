import * as React from 'react'
import { Slot } from 'radix-ui'

import { cn } from '@vertexade/ui/lib/utils'

function List({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="list" className={cn('divide-y divide-border/65', className)} {...props} />
}

function ListItem({
  className,
  interactive = false,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & { interactive?: boolean; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div'
  return (
    <Comp
      data-slot="list-item"
      data-interactive={interactive || undefined}
      className={cn(
        'group/list-item flex min-w-0 items-start gap-2.5 px-3 py-2.5',
        'data-[interactive=true]:cursor-pointer data-[interactive=true]:transition-colors data-[interactive=true]:hover:bg-accent/32 data-[interactive=true]:focus-visible:outline-none data-[interactive=true]:focus-visible:ring-2 data-[interactive=true]:focus-visible:ring-ring/40',
        className,
      )}
      {...props}
    />
  )
}

function ListItemMedia({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-item-media"
      className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5', className)}
      {...props}
    />
  )
}

function ListItemContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="list-item-content" className={cn('min-w-0 flex-1', className)} {...props} />
}

function ListItemTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-item-title"
      className={cn('flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium leading-5', className)}
      {...props}
    />
  )
}

function ListItemDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="list-item-description" className={cn('mt-0.5 text-xs leading-snug text-muted-foreground', className)} {...props} />
}

function ListItemMeta({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-item-meta"
      className={cn('mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground', className)}
      {...props}
    />
  )
}

function ListItemAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="list-item-action" className={cn('ml-auto flex shrink-0 items-center self-center', className)} {...props} />
}

export { List, ListItem, ListItemMedia, ListItemContent, ListItemTitle, ListItemDescription, ListItemMeta, ListItemAction }

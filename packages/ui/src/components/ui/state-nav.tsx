import * as React from 'react'

import { cn } from '@vertexade/ui/lib/utils'

function StateNav({ className, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      data-slot="state-nav"
      className={cn(
        'flex snap-x gap-1 overflow-x-auto border-b pb-1 [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] [scrollbar-width:none] sm:[mask-image:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  )
}

function StateNavItem({ active = false, className, ...props }: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-slot="state-nav-item"
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-11 min-w-max snap-start items-center gap-1.5 rounded-md bg-transparent px-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[active=true]:bg-muted/70 data-[active=true]:text-foreground sm:h-9 sm:px-2.5',
        className,
      )}
      {...props}
    />
  )
}

function StateNavIcon({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="state-nav-icon" className={cn('grid size-4 shrink-0 place-items-center [&_svg]:size-4', className)} {...props} />
}

function StateNavContent({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="state-nav-content" className={cn('min-w-0 flex-1', className)} {...props} />
}

function StateNavTitle({ className, ...props }: React.ComponentProps<'strong'>) {
  return <strong data-slot="state-nav-title" className={cn('block text-xs', className)} {...props} />
}

function StateNavDescription({ className, ...props }: React.ComponentProps<'small'>) {
  return (
    <small
      data-slot="state-nav-description"
      className={cn('hidden truncate text-[11px] text-muted-foreground sm:block', className)}
      {...props}
    />
  )
}

export { StateNav, StateNavItem, StateNavIcon, StateNavContent, StateNavTitle, StateNavDescription }

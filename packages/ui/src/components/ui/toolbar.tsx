import * as React from 'react'

import { Button, IconButton } from '@vertexade/ui/components/ui/button'
import { cn } from '@vertexade/ui/lib/utils'

function Toolbar({ className, sticky = false, ...props }: React.ComponentProps<'div'> & { sticky?: boolean }) {
  return (
    <div
      data-slot="toolbar"
      data-sticky={sticky || undefined}
      role="toolbar"
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border border-border/50 bg-muted/24 p-1.5 sm:flex-row sm:items-center',
        'data-[sticky=true]:sticky data-[sticky=true]:top-2 data-[sticky=true]:z-20 data-[sticky=true]:bg-background/92 data-[sticky=true]:shadow-[0_8px_24px_rgba(0,0,0,.12)] data-[sticky=true]:backdrop-blur-xl',
        className,
      )}
      {...props}
    />
  )
}

function ToolbarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="toolbar-group"
      className={cn(
        'flex min-w-0 snap-x items-center gap-1.5 overflow-x-auto overscroll-x-contain [mask-image:linear-gradient(to_right,#000_calc(100%-1rem),transparent)] [scrollbar-width:none] sm:[mask-image:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  )
}

function ToolbarLabel({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="toolbar-label" className={cn('shrink-0 text-[11px] font-medium text-muted-foreground', className)} {...props} />
}

function FilterBar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="filter-bar"
      role="search"
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_2.25rem] gap-1.5 rounded-lg border border-border/50 bg-muted/24 p-1.5 sm:flex sm:flex-wrap sm:items-center',
        className,
      )}
      {...props}
    />
  )
}

function FilterBarToggle({
  label,
  count = 0,
  active = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof IconButton>, 'label' | 'size' | 'variant'> & {
  label: string
  count?: number
  active?: boolean
}) {
  return (
    <IconButton
      label={label}
      size="icon-sm"
      variant={active ? 'secondary' : 'outline'}
      className={cn('relative sm:hidden', className)}
      {...props}
    >
      {children}
      {count > 0 && (
        <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-blue-500 text-[10px] text-white">
          {count}
        </span>
      )}
    </IconButton>
  )
}

function FilterBarControls({ className, open = false, ...props }: React.ComponentProps<'div'> & { open?: boolean }) {
  return (
    <div
      data-slot="filter-bar-controls"
      data-open={open || undefined}
      className={cn('col-span-2 hidden grid-cols-2 gap-2 data-[open=true]:grid sm:contents', className)}
      {...props}
    />
  )
}

function FilterChip({
  active = false,
  count,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'> & {
  active?: boolean
  count?: number
}) {
  return (
    <Button
      data-slot="filter-chip"
      variant={active ? 'secondary' : 'ghost'}
      size="xs"
      className={cn('shrink-0 snap-start', className)}
      aria-pressed={active}
      {...props}
    >
      {children}
      {count !== undefined && <span className="rounded-md bg-foreground/5 px-1 font-mono text-[10px] tabular-nums">{count}</span>}
    </Button>
  )
}

export { Toolbar, ToolbarGroup, ToolbarLabel, FilterBar, FilterBarToggle, FilterBarControls, FilterChip }

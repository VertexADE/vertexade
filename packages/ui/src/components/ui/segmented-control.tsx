import * as React from 'react'

import { Button } from '@vertexade/ui/components/ui/button'
import { cn } from '@vertexade/ui/lib/utils'

function SegmentedControl({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="segmented-control"
      role="group"
      className={cn('inline-flex min-w-0 items-center overflow-hidden rounded-lg bg-muted/42 p-0.5 ring-1 ring-border/35', className)}
      {...props}
    />
  )
}

function SegmentedControlItem({
  active = false,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'variant'> & { active?: boolean }) {
  return (
    <Button
      data-slot="segmented-control-item"
      variant={active ? 'secondary' : 'ghost'}
      aria-pressed={active}
      className={cn(
        'shadow-none data-[variant=secondary]:border-transparent data-[variant=secondary]:bg-background/88 data-[variant=secondary]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { SegmentedControl, SegmentedControlItem }

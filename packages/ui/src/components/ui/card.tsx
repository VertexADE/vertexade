import * as React from 'react'

import { cn } from '@vertexade/ui/lib/utils'

function Card({
  className,
  size = 'default',
  variant = 'default',
  layout = 'spaced',
  ...props
}: React.ComponentProps<'div'> & {
  size?: 'default' | 'sm'
  variant?: 'default' | 'subtle' | 'elevated'
  layout?: 'spaced' | 'divided'
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-variant={variant}
      data-layout={layout}
      className={cn(
        'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-lg border border-border/60 bg-card/76 py-(--card-spacing) text-sm text-card-foreground [--card-spacing:--spacing(3)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[layout=divided]:gap-0 data-[layout=divided]:py-0 data-[size=sm]:[--card-spacing:--spacing(2)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 data-[variant=subtle]:border-transparent data-[variant=subtle]:bg-muted/38 data-[variant=elevated]:border-border/80 data-[variant=elevated]:bg-card data-[variant=elevated]:shadow-[0_12px_36px_rgba(0,0,0,.14)] *:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg',
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-lg px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:border-border/55 [.border-b]:pb-(--card-spacing) group-data-[layout=divided]/card:border-b group-data-[layout=divided]/card:border-border/55 group-data-[layout=divided]/card:p-(--card-spacing)',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('font-heading text-[15px] leading-snug font-semibold tracking-[-.01em] group-data-[size=sm]/card:text-sm', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-description" className={cn('text-xs leading-snug text-muted-foreground', className)} {...props} />
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-action" className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)} {...props} />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-(--card-spacing) group-data-[layout=divided]/card:p-(--card-spacing)', className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center rounded-b-lg border-t border-border/55 bg-muted/24 p-(--card-spacing)', className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }

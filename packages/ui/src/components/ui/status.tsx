import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@vertexade/ui/lib/utils'

const statusVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium capitalize [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        info: 'border-info/30 bg-info/10 text-info',
        success: 'border-success/30 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        danger: 'border-destructive/30 bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

function Status({ className, tone = 'neutral', ...props }: React.ComponentProps<'span'> & VariantProps<typeof statusVariants>) {
  return <span data-slot="status" data-tone={tone} className={cn(statusVariants({ tone }), className)} {...props} />
}

function StatusPanel({
  className,
  tone = 'neutral',
  ...props
}: React.ComponentProps<'div'> & { tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }) {
  return (
    <div
      data-slot="status-panel"
      data-tone={tone}
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-3 rounded-lg border p-3 text-xs leading-relaxed sm:grid-cols-[auto_minmax(0,1fr)_auto]',
        'data-[tone=neutral]:bg-muted/25 data-[tone=neutral]:text-muted-foreground',
        'data-[tone=info]:border-info/25 data-[tone=info]:bg-info/5 data-[tone=info]:text-info',
        'data-[tone=success]:border-success/25 data-[tone=success]:bg-success/5 data-[tone=success]:text-success',
        'data-[tone=warning]:border-warning/25 data-[tone=warning]:bg-warning/5 data-[tone=warning]:text-warning',
        'data-[tone=danger]:border-destructive/25 data-[tone=danger]:bg-destructive/5 data-[tone=danger]:text-destructive',
        '[&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  )
}

function StatusPanelContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="status-panel-content" className={cn('col-start-2 min-w-0', className)} {...props} />
}

function StatusPanelTitle({ className, ...props }: React.ComponentProps<'strong'>) {
  return <strong data-slot="status-panel-title" className={cn('block text-sm font-medium', className)} {...props} />
}

function StatusPanelDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p data-slot="status-panel-description" className={cn('mt-0.5 text-xs leading-relaxed text-muted-foreground', className)} {...props} />
  )
}

function StatusPanelActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="status-panel-actions"
      className={cn(
        'col-span-2 col-start-1 flex w-full items-center gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:w-auto sm:self-center',
        className,
      )}
      {...props}
    />
  )
}

export { Status, StatusPanel, StatusPanelActions, StatusPanelContent, StatusPanelDescription, StatusPanelTitle, statusVariants }

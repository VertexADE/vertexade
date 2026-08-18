import * as React from 'react'

import { Label } from '@vertexade/ui/components/ui/label'
import { cn } from '@vertexade/ui/lib/utils'

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cn('grid gap-4', className)} {...props} />
}

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return <fieldset data-slot="field-set" className={cn('grid min-w-0 gap-3', className)} {...props} />
}

function FieldLegend({ className, ...props }: React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }) {
  const { variant = 'legend', ...legendProps } = props
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(variant === 'label' ? 'text-xs font-medium' : 'text-sm font-semibold', className)}
      {...legendProps}
    />
  )
}

function Field({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<'div'> & { orientation?: 'vertical' | 'horizontal' }) {
  return (
    <div
      data-slot="field"
      data-orientation={orientation}
      className={cn('grid min-w-0 gap-1.5', orientation === 'horizontal' && 'grid-cols-[auto_minmax(0,1fr)] items-center gap-2', className)}
      {...props}
    />
  )
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" className={cn('text-xs font-medium', className)} {...props} />
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="field-description" className={cn('text-[11px] leading-relaxed text-muted-foreground', className)} {...props} />
}

function FieldError({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="field-error" role="alert" className={cn('text-[11px] leading-relaxed text-destructive', className)} {...props} />
}

export { FieldGroup, FieldSet, FieldLegend, Field, FieldLabel, FieldDescription, FieldError }

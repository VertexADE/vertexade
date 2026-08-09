import * as React from 'react'

import { Label } from '@vertexade/ui/components/ui/label'
import { cn } from '@vertexade/ui/lib/utils'

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cn('grid gap-4', className)} {...props} />
}

function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field" className={cn('grid min-w-0 gap-1.5', className)} {...props} />
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

export { FieldGroup, Field, FieldLabel, FieldDescription, FieldError }

import type { ChangeEvent } from 'react'
import type { ContextualActionInputField } from '@vertexade/platform-contracts'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { cn } from '@vertexade/ui/lib/utils'

export function ContextualActionField({
  field,
  value,
  disabled,
  requirementHint = false,
  textareaClassName,
  onChange,
}: {
  field: ContextualActionInputField
  value: string
  disabled: boolean
  requirementHint?: boolean
  textareaClassName?: string
  onChange(value: string): void
}) {
  const inputProps = {
    value,
    disabled,
    required: field.required,
    maxLength: field.maxLength,
    placeholder: field.placeholder,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  }
  return (
    <Label className="flex-col items-stretch gap-1.5">
      <FieldLabel field={field} requirementHint={requirementHint} />
      <FieldControl field={field} inputProps={inputProps} textareaClassName={textareaClassName} />
      <FieldDescription description={field.description} />
    </Label>
  )
}

function FieldLabel({ field, requirementHint }: { field: ContextualActionInputField; requirementHint: boolean }) {
  if (!requirementHint)
    return (
      <span>
        {field.label}
        {field.required ? ' *' : ''}
      </span>
    )
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span>{field.label}</span>
      <small className="font-normal text-muted-foreground">{field.required ? 'Required' : 'Optional'}</small>
    </span>
  )
}

function FieldControl({
  field,
  inputProps,
  textareaClassName,
}: {
  field: ContextualActionInputField
  inputProps: {
    value: string
    disabled: boolean
    required?: boolean
    maxLength?: number
    placeholder?: string
    onChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void
  }
  textareaClassName?: string
}) {
  if (field.type === 'textarea') return <Textarea {...inputProps} className={cn('min-h-28', textareaClassName)} />
  return <Input {...inputProps} />
}

function FieldDescription({ description }: { description?: string }) {
  if (!description) return null
  return <small className="block text-muted-foreground">{description}</small>
}

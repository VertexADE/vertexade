import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ModuleCatalogEntry, PortableSettingsField, PortableSettingsSurface } from '@vertexade/platform-contracts'
import {
  portableRecords,
  portableSettingsFieldStored,
  portableSettingsOptions,
  portableSettingsValidationErrors,
  portableSettingsValues,
  readPortablePath,
  type PortableSettingsValues,
} from '@vertexade/platform-contracts/portable'
import { AlertTriangle, ArrowDown, ArrowUp, LoaderCircle, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'
import { platformClient } from '@vertexade/ui/lib/dashboard-api'

type FieldEditorProps = {
  field: PortableSettingsField
  value: unknown
  source: unknown
  optionSource: unknown
  actionResults: Record<string, unknown>
  onChange(value: unknown): void
}

export function portableSettingsFieldLayoutClassName(type: PortableSettingsField['type']): string | undefined {
  return ['multiselect', 'string-list', 'object-list', 'textarea'].includes(type) ? 'col-span-full' : undefined
}

function visible(field: PortableSettingsField, values: unknown) {
  if (!field.visibleWhen) return true
  const value = readPortablePath(values, field.visibleWhen.input)
  if ('equals' in field.visibleWhen) return value === field.visibleWhen.equals
  if ('notEquals' in field.visibleWhen) return value !== field.visibleWhen.notEquals
  return true
}

function optionValues(field: PortableSettingsField, optionSource: unknown, actionResults: Record<string, unknown>, selected: unknown) {
  const options = portableSettingsOptions(field, optionSource, actionResults)
  const selectedValues = Array.isArray(selected) ? selected : [selected]
  for (const value of selectedValues.map(String).filter(Boolean)) {
    if (!options.some((option) => option.value === value)) options.push({ value, label: value })
  }
  return options
}

function FieldEditor({ field, value, source, optionSource, actionResults, onChange }: FieldEditorProps) {
  const id = `portable-setting-${field.name}`
  if (!visible(field, optionSource)) return null
  if (field.type === 'hidden') return null
  const description = field.description && <FieldDescription>{field.description}</FieldDescription>
  const required = Boolean(field.required && !portableSettingsFieldStored(field, source))
  const layoutClassName = portableSettingsFieldLayoutClassName(field.type)

  if (field.type === 'boolean')
    return (
      <Field className={layoutClassName}>
        <FieldLabel className="flex items-center gap-2" htmlFor={id}>
          <Checkbox id={id} checked={Boolean(value)} onCheckedChange={(checked) => onChange(Boolean(checked))} />
          {field.label}
        </FieldLabel>
        {description}
      </Field>
    )

  if (field.type === 'select') {
    const options = optionValues(field, optionSource, actionResults, value)
    return (
      <Field className={layoutClassName}>
        <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
        <Select value={String(value || '')} required={required} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={field.placeholder || `Choose ${field.label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {description}
      </Field>
    )
  }

  if (field.type === 'multiselect') {
    const values = Array.isArray(value) ? value.map(String) : []
    const options = optionValues(field, optionSource, actionResults, values)
    const atMaximum = values.length >= (field.maxItems || Infinity)
    return (
      <Field className={layoutClassName}>
        <FieldLabel>{field.label}</FieldLabel>
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-xs">
              <Checkbox
                disabled={!values.includes(option.value) && atMaximum}
                checked={values.includes(option.value)}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...values, option.value] : values.filter((item) => item !== option.value))
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
          {!options.length && <p className="text-xs text-muted-foreground">Use the discovery action to load choices.</p>}
        </div>
        {description}
      </Field>
    )
  }

  if (field.type === 'string-list') {
    const values = Array.isArray(value) ? value.map(String) : []
    return (
      <Field className={layoutClassName}>
        <FieldLabel>{field.label}</FieldLabel>
        <div className="space-y-2">
          {values.map((item, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={item}
                required={required}
                placeholder={field.placeholder}
                onChange={(event) =>
                  onChange(values.map((current, currentIndex) => (currentIndex === index ? event.target.value : current)))
                }
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${field.label}`}
                onClick={() => onChange(values.filter((_current, currentIndex) => currentIndex !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={values.length >= (field.maxItems || Infinity)}
            onClick={() => onChange([...values, ''])}
          >
            <Plus />
            {field.addLabel || 'Add value'}
          </Button>
        </div>
        {description}
      </Field>
    )
  }

  if (field.type === 'object-list') {
    const rows = portableRecords(value)
    const sourceRows = portableRecords(readPortablePath(source, field.valuePath || field.name))
    const nestedFields = field.fields || []
    const update = (index: number, next: Record<string, unknown>) => onChange(rows.map((row, current) => (current === index ? next : row)))
    return (
      <Field className={layoutClassName}>
        <FieldLabel>{field.label}</FieldLabel>
        {description}
        <div className="space-y-3">
          {rows.map((row, index) => (
            <Card key={index} size="sm" variant="subtle" className="min-w-0">
              <CardContent className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3">
                {nestedFields.map((nested) => (
                  <FieldEditor
                    key={nested.name}
                    field={nested}
                    value={row[nested.name]}
                    source={sourceRows[index] || {}}
                    optionSource={{ ...(optionSource as Record<string, unknown>), ...row }}
                    actionResults={actionResults}
                    onChange={(next) => update(index, { ...row, [nested.name]: next })}
                  />
                ))}
                <div className="col-span-full flex justify-end gap-1">
                  {field.allowReorder && (
                    <>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={!index}
                        onClick={() => {
                          const next = [...rows]
                          ;[next[index - 1], next[index]] = [next[index]!, next[index - 1]!]
                          onChange(next)
                        }}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={index === rows.length - 1}
                        onClick={() => {
                          const next = [...rows]
                          ;[next[index + 1], next[index]] = [next[index]!, next[index + 1]!]
                          onChange(next)
                        }}
                      >
                        <ArrowDown />
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={rows.length <= (field.minItems || 0)}
                    onClick={() => onChange(rows.filter((_row, current) => current !== index))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={rows.length >= (field.maxItems || Infinity)}
            onClick={() => onChange([...rows, portableSettingsValues({}, nestedFields)])}
          >
            <Plus />
            {field.addLabel || 'Add item'}
          </Button>
        </div>
      </Field>
    )
  }

  const common = {
    id,
    required,
    value: String(value ?? ''),
    placeholder: field.placeholder || (portableSettingsFieldStored(field, source) ? 'Stored securely · leave blank to keep it' : undefined),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  }
  return (
    <Field className={layoutClassName}>
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      {field.type === 'textarea' ? (
        <Textarea {...common} className="min-h-28" />
      ) : (
        <Input {...common} type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'} />
      )}
      {description}
    </Field>
  )
}

export function PortableSettingsPanel({
  module,
  settings,
  onChanged,
}: {
  module: ModuleCatalogEntry
  settings: PortableSettingsSurface
  onChanged(): void
}) {
  const confirmAction = useConfirm()
  const extension = useMemo(() => platformClient.extension(module.id), [module.id])
  const [source, setSource] = useState<Record<string, unknown>>({})
  const [values, setValues] = useState<PortableSettingsValues>({})
  const [actionResults, setActionResults] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await extension.loadSettings<Record<string, unknown>>(settings)
      setSource(result)
      setValues(portableSettingsValues(result, settings))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Settings could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [extension, settings])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const validationErrors = portableSettingsValidationErrors(settings, values, source)
    if (validationErrors.length) {
      toast.error(validationErrors[0])
      return
    }
    setBusy('submit')
    try {
      await extension.saveSettings(settings, values)
      toast.success(settings.submit?.successMessage || 'Settings saved.')
      await load()
      onChanged()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Settings could not be saved')
    } finally {
      setBusy('')
    }
  }

  const runAction = async (actionId: string) => {
    const action = settings.actions?.find((candidate) => candidate.id === actionId)
    if (!action) return
    if (action.confirm && !(await confirmAction(action.confirm))) return
    setBusy(action.id)
    try {
      const result = await extension.executeSettingsAction(settings, action, values)
      if (action.intent === 'discover') setActionResults((current) => ({ ...current, [action.id]: result }))
      else {
        await load()
        onChanged()
      }
      if (action.successMessage) toast.success(action.successMessage)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : `${action.label} failed`)
    } finally {
      setBusy('')
    }
  }

  if (loading)
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading extension settings…
        </CardContent>
      </Card>
    )
  if (error)
    return (
      <Card className="border-red-500/30">
        <CardContent className="grid gap-3 p-4 text-xs sm:grid-cols-[1fr_auto]">
          <span className="flex gap-2 break-words text-red-400">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RotateCcw />
            Retry
          </Button>
        </CardContent>
      </Card>
    )

  const sections = settings.sections?.length
    ? settings.sections.map((section) => ({
        ...section,
        definitions: settings.fields.filter((field) => section.fields.includes(field.name)),
      }))
    : [{ id: 'settings', title: '', description: '', definitions: settings.fields }]
  const configured = settings.source.configuredPath ? Boolean(readPortablePath(source, settings.source.configuredPath)) : undefined

  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle>{settings.title}</CardTitle>
        {settings.description && <CardDescription>{settings.description}</CardDescription>}
      </CardHeader>
      <form onSubmit={save}>
        <CardContent className="space-y-6">
          {sections.map((section) => (
            <section key={section.id} className="space-y-3">
              {section.title && (
                <div>
                  <h3 className="text-sm font-medium">{section.title}</h3>
                  {section.description && <p className="text-xs text-muted-foreground">{section.description}</p>}
                </div>
              )}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4">
                {section.definitions.map((field) => (
                  <FieldEditor
                    key={field.name}
                    field={field}
                    value={values[field.name]}
                    source={source}
                    optionSource={{ ...source, ...values }}
                    actionResults={actionResults}
                    onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
                  />
                ))}
              </div>
            </section>
          ))}
          {(settings.actions || [])
            .filter((action) => action.intent === 'discover')
            .map((action) => (
              <Button key={action.id} type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void runAction(action.id)}>
                {busy === action.id && <LoaderCircle className="animate-spin" />}
                {action.label}
              </Button>
            ))}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {configured === undefined ? '' : configured ? 'Configured' : 'Not configured'}
          </span>
          <div className="grid gap-2 sm:flex">
            {(settings.actions || [])
              .filter((action) => action.intent === 'reset')
              .map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  disabled={Boolean(busy)}
                  onClick={() => void runAction(action.id)}
                >
                  {action.label}
                </Button>
              ))}
            {settings.submit && (
              <Button disabled={Boolean(busy)}>
                {busy === 'submit' && <LoaderCircle className="animate-spin" />}
                {settings.submit.label}
              </Button>
            )}
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}

export function ExtensionSettingsPanel({ module, onChanged }: { module: ModuleCatalogEntry; onChanged(): void }) {
  if (!module.portable?.settings)
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">This extension does not expose additional settings.</CardContent>
      </Card>
    )
  return <PortableSettingsPanel module={module} settings={module.portable.settings} onChanged={onChanged} />
}

import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Palette, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'
import type { HighlightRule, Preset } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

const placeholders = ['repo', 'pr_number', 'pr_title', 'pr_url', 'author', 'base_branch', 'head_branch']
const highlightColors = ['#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#ec4899']

function PresetEditor({
  name,
  prompt,
  editing,
  onNameChange,
  onPromptChange,
  onInsertPlaceholder,
  onCancel,
  onSubmit,
}: {
  name: string
  prompt: string
  editing: boolean
  onNameChange(value: string): void
  onPromptChange(value: string): void
  onInsertPlaceholder(value: string): void
  onCancel(): void
  onSubmit(event: React.FormEvent): void
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 border-b p-4 md:border-r md:border-b-0">
      <div className="flex items-center justify-between">
        <strong className="text-xs">{editing ? 'Edit preset' : 'New preset'}</strong>
        {editing && (
          <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
            Cancel edit
          </Button>
        )}
      </div>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="preset-name">Name</FieldLabel>
          <Input
            id="preset-name"
            required
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Release review"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="preset-prompt">Instructions</FieldLabel>
          <Textarea
            id="preset-prompt"
            required
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Reusable prompt with {{pr_title}}, {{author}}, …"
            className="min-h-28 text-xs"
          />
          <FieldDescription>Insert supported context placeholders below.</FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap gap-1.5">
        {placeholders.map((item) => (
          <Button
            key={item}
            type="button"
            variant="outline"
            size="xs"
            className="font-mono text-[11px]"
            onClick={() => onInsertPlaceholder(item)}
          >
            {`{{${item}}}`}
          </Button>
        ))}
      </div>
      <Button size="sm">{editing ? 'Update preset' : 'Save preset'}</Button>
    </form>
  )
}

function PresetList({
  presets,
  editingId,
  onEdit,
  onRemove,
}: {
  presets: Preset[]
  editingId: number | null
  onEdit(preset: Preset): void
  onRemove(id: number): void
}) {
  return (
    <CardContent className="max-h-80 overflow-y-auto p-0">
      {presets.map((preset) => (
        <div key={preset.id} className={cn('border-b p-3 last:border-0', editingId === preset.id && 'bg-primary/[.05]')}>
          <div className="flex justify-between gap-2">
            <strong className="font-mono text-xs text-primary">[{preset.name}]</strong>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-xs" onClick={() => onEdit(preset)}>
                <Pencil />
                <span className="sr-only">Edit preset</span>
              </Button>
              <Button variant="ghost" size="icon-xs" onClick={() => onRemove(preset.id)}>
                <Trash2 />
                <span className="sr-only">Delete preset</span>
              </Button>
            </div>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">{preset.prompt}</p>
        </div>
      ))}
      {!presets.length && (
        <Empty className="m-3 min-h-48 border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Plus />
            </EmptyMedia>
            <EmptyTitle>No prompt presets</EmptyTitle>
            <EmptyDescription>Create a reusable instruction for recurring pull-request work.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </CardContent>
  )
}

export function Presets({ presets, backendId }: { presets: Preset[]; backendId: string }) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<number | null>(null)
  const mutation = useMutation({
    mutationFn: ({ id, name, prompt }: { id: number | null; name: string; prompt: string }) =>
      backendApi(backendId, id ? `/api/presets/${id}` : '/api/presets', {
        method: 'POST',
        body: JSON.stringify({ name, prompt }),
      }),
  })
  const form = useForm({
    defaultValues: { name: '', prompt: '' },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync({ id: editingId, name: value.name.trim(), prompt: value.prompt.trim() })
        toast.success(editingId ? `Updated [${value.name.trim()}]` : `Saved [${value.name.trim()}]`)
        reset()
        await queryClient.invalidateQueries({ queryKey: ['platform'] })
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  const values = useStore(form.store, (state) => state.values)
  function reset() {
    setEditingId(null)
    form.reset()
  }
  function edit(preset: Preset) {
    setEditingId(preset.id)
    form.reset({ name: preset.name, prompt: preset.prompt })
  }
  async function remove(id: number) {
    try {
      await backendApi(backendId, `/api/presets/${id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['platform'] })
      toast.success('Preset deleted')
      if (editingId === id) reset()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle>Prompt presets</CardTitle>
        <CardDescription>Reusable instructions available when starting work on a pull request.</CardDescription>
        <CardAction>
          <span className="text-[11px] text-muted-foreground">{presets.length} saved</span>
        </CardAction>
      </CardHeader>
      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PresetEditor
          name={values.name}
          prompt={values.prompt}
          editing={editingId !== null}
          onNameChange={(value) => form.setFieldValue('name', value)}
          onPromptChange={(value) => form.setFieldValue('prompt', value)}
          onInsertPlaceholder={(item) => form.setFieldValue('prompt', (value) => `${value}{{${item}}}`)}
          onCancel={reset}
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        />
        <PresetList presets={presets} editingId={editingId} onEdit={edit} onRemove={(id) => void remove(id)} />
      </div>
    </Card>
  )
}

export function Highlights({ rules, backendId }: { rules: HighlightRule[]; backendId: string }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (value: { text: string; color: string }) =>
      backendApi(backendId, '/api/highlights', { method: 'POST', body: JSON.stringify(value) }),
  })
  const form = useForm({
    defaultValues: { text: '', color: highlightColors[0]! },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync({ text: value.text.trim(), color: value.color })
        toast.success(`Highlighting “${value.text.trim()}” globally`)
        form.setFieldValue('text', '')
        await queryClient.invalidateQueries({ queryKey: ['platform'] })
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  const values = useStore(form.store, (state) => state.values)
  async function remove(rule: HighlightRule) {
    try {
      await backendApi(backendId, `/api/highlights/${rule.id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['platform'] })
      toast.success(`Removed “${rule.text}”`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette />
          Global highlights
        </CardTitle>
        <CardDescription>Highlight matching text throughout every manager screen.</CardDescription>
        <CardAction>
          <span className="text-[11px] text-muted-foreground">{rules.length} active</span>
        </CardAction>
      </CardHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className="flex flex-col gap-3 p-3"
      >
        <Field>
          <FieldLabel htmlFor="highlight-text">Text or phrase</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="highlight-text"
              required
              maxLength={100}
              value={values.text}
              onChange={(event) => form.setFieldValue('text', event.target.value)}
              placeholder="Text or phrase"
              className="h-8 min-w-0"
            />
            <input
              type="color"
              value={values.color}
              onChange={(event) => form.setFieldValue('color', event.target.value)}
              aria-label="Highlight color"
              className="h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-background p-1"
            />
          </div>
          <FieldDescription>Matches are applied globally and stored with the workspace.</FieldDescription>
        </Field>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {highlightColors.map((item) => (
              <button
                key={item}
                type="button"
                aria-label={`Use ${item}`}
                onClick={() => form.setFieldValue('color', item)}
                className={cn(
                  'size-5 rounded-full border-2 border-background ring-1 ring-border',
                  values.color === item && 'ring-2 ring-foreground',
                )}
                style={{ backgroundColor: item }}
              />
            ))}
          </div>
          <Button size="xs">
            <Plus data-icon="inline-start" />
            Add
          </Button>
        </div>
      </form>
      <CardContent className="max-h-64 overflow-y-auto p-0">
        {rules.map((rule) => (
          <div key={rule.id} className="flex items-center gap-2 border-b p-2.5 last:border-0">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: rule.color }} />
            <span className="min-w-0 flex-1 truncate text-xs">{rule.text}</span>
            <Button variant="ghost" size="icon-xs" onClick={() => remove(rule)}>
              <Trash2 />
              <span className="sr-only">Delete highlight</span>
            </Button>
          </div>
        ))}
        {!rules.length && (
          <Empty className="m-3 min-h-32 border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Palette />
              </EmptyMedia>
              <EmptyTitle>No highlights configured</EmptyTitle>
              <EmptyDescription>Add words or phrases that should stand out across manager screens.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}

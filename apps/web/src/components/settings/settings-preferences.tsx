import { useState } from 'react'
import { Palette, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Input } from '@vertexade/ui/components/ui/input'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { DashboardData, HighlightRule } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

const placeholders = ['repo', 'pr_number', 'pr_title', 'pr_url', 'author', 'base_branch', 'head_branch']
const highlightColors = ['#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#ec4899']

export function Presets({ data }: { data: DashboardData }) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  function reset() {
    setEditingId(null)
    setName('')
    setPrompt('')
  }
  function edit(preset: DashboardData['presets'][number]) {
    setEditingId(preset.id)
    setName(preset.name)
    setPrompt(preset.prompt)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    try {
      await api(editingId ? `/api/presets/${editingId}` : '/api/presets', {
        method: 'POST',
        body: JSON.stringify({ name, prompt }),
      })
      toast.success(editingId ? `Updated [${name}]` : `Saved [${name}]`)
      reset()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  async function remove(id: number) {
    try {
      await api(`/api/presets/${id}`, { method: 'DELETE' })
      toast.success('Preset deleted')
      if (editingId === id) reset()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="font-mono text-sm">Prompt presets</CardTitle>
        <CardDescription>Reusable instructions available when starting work on a pull request.</CardDescription>
      </CardHeader>
      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form onSubmit={save} className="space-y-2 border-b p-4 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between">
            <strong className="text-xs">{editingId ? 'Edit preset' : 'New preset'}</strong>
            {editingId && (
              <Button type="button" variant="ghost" size="xs" onClick={reset}>
                Cancel edit
              </Button>
            )}
          </div>
          <Input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Preset name" />
          <Textarea
            required
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Reusable prompt with {{pr_title}}, {{author}}, …"
            className="min-h-28 text-xs"
          />
          <div className="flex flex-wrap gap-1">
            {placeholders.map((item) => (
              <Button
                key={item}
                type="button"
                variant="outline"
                size="xs"
                className="font-mono text-[11px]"
                onClick={() => setPrompt((value) => `${value}{{${item}}}`)}
              >{`{{${item}}}`}</Button>
            ))}
          </div>
          <Button size="sm">{editingId ? 'Update preset' : 'Save preset'}</Button>
        </form>
        <CardContent className="max-h-80 overflow-y-auto p-0">
          {data.presets.map((preset) => (
            <div key={preset.id} className={cn('border-b p-3 last:border-0', editingId === preset.id && 'bg-blue-500/5')}>
              <div className="flex justify-between gap-2">
                <strong className="font-mono text-xs text-blue-400">[{preset.name}]</strong>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-xs" onClick={() => edit(preset)}>
                    <Pencil />
                    <span className="sr-only">Edit preset</span>
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => remove(preset.id)}>
                    <Trash2 />
                    <span className="sr-only">Delete preset</span>
                  </Button>
                </div>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">{preset.prompt}</p>
            </div>
          ))}
        </CardContent>
      </div>
    </Card>
  )
}

export function Highlights({ rules }: { rules: HighlightRule[] }) {
  const [text, setText] = useState('')
  const [color, setColor] = useState(highlightColors[0])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    try {
      await api('/api/highlights', { method: 'POST', body: JSON.stringify({ text, color }) })
      toast.success(`Highlighting “${text}” globally`)
      setText('')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  async function remove(rule: HighlightRule) {
    try {
      await api(`/api/highlights/${rule.id}`, { method: 'DELETE' })
      toast.success(`Removed “${rule.text}”`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <Palette className="size-4" />
          Global highlights
        </CardTitle>
        <CardDescription>Highlight matching text throughout every manager screen.</CardDescription>
      </CardHeader>
      <form onSubmit={save} className="space-y-2 border-b p-3">
        <div className="flex gap-2">
          <Input
            required
            maxLength={100}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Text or phrase"
            className="h-8 min-w-0"
          />
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            aria-label="Highlight color"
            className="h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-background p-1"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {highlightColors.map((item) => (
              <button
                key={item}
                type="button"
                aria-label={`Use ${item}`}
                onClick={() => setColor(item)}
                className={cn(
                  'size-5 rounded-full border-2 border-background ring-1 ring-border',
                  color === item && 'ring-2 ring-foreground',
                )}
                style={{ backgroundColor: item }}
              />
            ))}
          </div>
          <Button size="xs">
            <Plus />
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
        {!rules.length && <p className="p-4 text-center text-[11px] text-muted-foreground">No highlights configured.</p>}
      </CardContent>
    </Card>
  )
}

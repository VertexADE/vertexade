import { useState } from 'react'
import { Columns2, Eye, Pencil } from 'lucide-react'

import { MarkdownContent } from '@vertexade/ui/components/markdown-content'
import { Button } from '@vertexade/ui/components/ui/button'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { cn } from '@vertexade/ui/lib/utils'

export type MarkdownEditorMode = 'write' | 'preview' | 'split'

type MarkdownEditorProps = {
  id: string
  value: string
  onChange(value: string): void
  onBlur?(): void
  placeholder?: string
  maxLength?: number
  defaultMode?: MarkdownEditorMode
  className?: string
  textareaClassName?: string
}

const modes = [
  { value: 'write', label: 'Write', icon: Pencil },
  { value: 'preview', label: 'Preview', icon: Eye },
  { value: 'split', label: 'Split', icon: Columns2 },
] as const

function MarkdownPreview({ value, className }: { value: string; className?: string }) {
  return (
    <div className={cn('min-h-56 overflow-auto rounded-md border bg-muted/10 p-4', className)} aria-label="Markdown preview">
      {value.trim() ? <MarkdownContent content={value} /> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}
    </div>
  )
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  maxLength = 10_000,
  defaultMode = 'write',
  className,
  textareaClassName,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<MarkdownEditorMode>(defaultMode)
  const editor = (
    <Textarea
      id={id}
      className={cn('min-h-56 resize-y font-mono text-sm leading-relaxed', textareaClassName)}
      maxLength={maxLength}
      required
      value={value}
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
  )

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/15 p-1">
        <div className="flex items-center gap-1" role="group" aria-label="Markdown editor mode">
          {modes.map((option) => {
            const Icon = option.icon
            return (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={mode === option.value ? 'secondary' : 'ghost'}
                aria-pressed={mode === option.value}
                onClick={() => setMode(option.value)}
              >
                <Icon data-icon="inline-start" /> {option.label}
              </Button>
            )
          })}
        </div>
        <span className="px-2 font-mono text-[11px] text-muted-foreground">
          {value.length.toLocaleString()} / {maxLength.toLocaleString()}
        </span>
      </div>
      {mode === 'write' ? editor : null}
      {mode === 'preview' ? <MarkdownPreview value={value} /> : null}
      {mode === 'split' ? (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {editor}
          <MarkdownPreview value={value} className="max-h-[32rem]" />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Markdown, tables, task lists, code blocks, links, and Mermaid diagrams are supported.</p>
    </div>
  )
}

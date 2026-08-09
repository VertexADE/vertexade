import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { parsePatchFiles, type DiffLineAnnotation, type FileDiffContentsLoader } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import type { Editor, EditorOptions } from '@pierre/diffs/edit'
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileCode2,
  MessageSquarePlus,
  PencilLine,
  Redo2,
  RotateCcw,
  Undo2,
} from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { createAddToChatAction } from '@vertexade/ui/components/diff-chat-action'
import { DiffEditProvider } from '@vertexade/ui/components/diff-edit-provider'
import { DiffFileTree } from '@vertexade/ui/components/diff-file-tree'
import { Label } from '@vertexade/ui/components/ui/label'
import { ScrollArea } from '@vertexade/ui/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import type { DiffFile } from '@vertexade/ui/lib/dashboard-types'
import type { ChatCodeSelection, DiffFileRevision } from '@vertexade/ui/lib/code-selection'
import { cn } from '@vertexade/ui/lib/utils'

const overflowStyle = { true: 'wrap', false: 'scroll' } as const
const commentSide = { deletions: 'LEFT', additions: 'RIGHT' } as const
const annotationSide = { LEFT: 'deletions', RIGHT: 'additions' } as const
const mobileScrollCSS = `
  [data-code] {
    overflow-x: auto !important;
    overflow-y: hidden !important;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x pan-y;
    overscroll-behavior-x: contain;
  }
`

export type DiffCommentTarget = { path: string; line: number; side: 'LEFT' | 'RIGHT' }
export type DiffReviewAnnotation<T extends object> = DiffCommentTarget & { metadata: T }

type DiffReviewProps<T extends object> = {
  patch: string
  files: DiffFile[]
  annotations?: DiffReviewAnnotation<T>[]
  renderAnnotation?: (metadata: T) => ReactNode
  onLineComment?: (target: DiffCommentTarget) => void
  onAddToChat?: (selection: ChatCodeSelection) => void
  loadFile?: (path: string, revision: DiffFileRevision) => Promise<string>
  preferredPath?: string
  preferredTarget?: Pick<DiffCommentTarget, 'line' | 'side'>
}

export function createDiffFileContentsLoader(loadFile: NonNullable<DiffReviewProps<object>['loadFile']>): FileDiffContentsLoader {
  return async (metadata) => {
    const oldPath = metadata.prevName || metadata.name
    const [oldContents, newContents] = await Promise.all([loadFile(oldPath, 'base'), loadFile(metadata.name, 'current')])
    return {
      oldFile: { name: oldPath, contents: oldContents, cacheKey: `base:${oldPath}` },
      newFile: { name: metadata.name, contents: newContents, cacheKey: `current:${metadata.name}` },
    }
  }
}

function patchCacheKey(patch: string) {
  let hash = 0
  for (let index = 0; index < patch.length; index += 1) hash = Math.imul(31, hash) + patch.charCodeAt(index)
  return `vertexade-${(hash >>> 0).toString(36)}`
}

function annotationsForFile<T extends object>(annotations: DiffReviewAnnotation<T>[], path?: string) {
  if (!path) return []
  return annotations
    .filter((annotation) => annotation.path === path)
    .map((annotation) => ({
      side: annotationSide[annotation.side],
      lineNumber: annotation.line,
      metadata: annotation.metadata,
    })) as unknown as DiffLineAnnotation<T>[]
}

export function diffAnnotationSlot(target: Pick<DiffCommentTarget, 'line' | 'side'>) {
  return `annotation-${annotationSide[target.side]}-${target.line}`
}

export function DiffReview<T extends object = never>({
  patch,
  files,
  annotations = [],
  renderAnnotation,
  onLineComment,
  onAddToChat,
  loadFile,
  preferredPath,
  preferredTarget,
}: DiffReviewProps<T>) {
  const [selected, setSelected] = useState(0)
  const [style, setStyle] = useState<'unified' | 'split'>('unified')
  const [wrap, setWrap] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftRevision, setDraftRevision] = useState(0)
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(() => new Set())
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
  const diffPane = useRef<HTMLDivElement>(null)
  const editor = useRef<Editor<T> | null>(null)
  const originalContents = useRef(new Map<string, string>())
  const parsed = useMemo(
    () => (patch ? parsePatchFiles(patch, `${patchCacheKey(patch)}-${draftRevision}`).flatMap((item) => item.files) : []),
    [draftRevision, patch],
  )
  const index = Math.min(selected, Math.max(0, files.length - 1))
  const file = files[index]
  const fileDiff = parsed[index]
  const fileAnnotations = useMemo(() => annotationsForFile(annotations, file?.path), [annotations, file?.path])
  const editorOptions = useMemo<EditorOptions<T> | undefined>(
    () =>
      onAddToChat
        ? {
            enabledSelectionAction: true,
            persistState: true,
            renderSelectionAction: createAddToChatAction<T>(onAddToChat, file?.path),
            onAttach: (value) => {
              editor.current = value
              const attachedFile = value.getFile()
              if (attachedFile && !originalContents.current.has(attachedFile.name))
                originalContents.current.set(attachedFile.name, value.getText())
              setHistory({ canUndo: value.canUndo, canRedo: value.canRedo })
            },
            onChange: (changedFile) => {
              const original = originalContents.current.get(changedFile.name)
              const changed = original === undefined ? Boolean(editor.current?.canUndo) : changedFile.contents !== original
              setDirtyFiles((current) => {
                const next = new Set(current)
                if (changed) next.add(changedFile.name)
                else next.delete(changedFile.name)
                return next
              })
              setHistory({ canUndo: Boolean(editor.current?.canUndo), canRedo: Boolean(editor.current?.canRedo) })
            },
          }
        : undefined,
    [file?.path, onAddToChat],
  )
  const options = useMemo(
    () => ({
      theme: 'pierre-dark' as const,
      themeType: 'dark' as const,
      diffStyle: style,
      diffIndicators: 'bars' as const,
      lineDiffType: 'word-alt' as const,
      overflow: overflowStyle[String(wrap) as 'true' | 'false'],
      unsafeCSS: mobileScrollCSS,
      loadDiffFiles: loadFile ? createDiffFileContentsLoader(loadFile) : undefined,
      hunkSeparators: 'line-info' as const,
      lineHoverHighlight: onLineComment ? ('number' as const) : ('disabled' as const),
      onLineNumberClick:
        onLineComment && file
          ? ({ lineNumber, annotationSide }: { lineNumber: number; annotationSide: 'deletions' | 'additions' }) =>
              onLineComment({
                path: file.path,
                line: lineNumber,
                side: commentSide[annotationSide],
              })
          : undefined,
    }),
    [file, loadFile, onLineComment, style, wrap],
  )

  useEffect(() => {
    const preferredIndex = preferredPath ? files.findIndex((item) => item.path === preferredPath) : -1
    setSelected(Math.max(0, preferredIndex))
    setEditing(false)
    setDraftRevision(0)
    setDirtyFiles(new Set())
    setHistory({ canUndo: false, canRedo: false })
    editor.current = null
    originalContents.current.clear()
  }, [files, patch, preferredPath])

  useEffect(() => {
    if (!preferredTarget || file?.path !== preferredPath) return
    const slot = diffAnnotationSlot(preferredTarget)
    let attempts = 0
    let timer = 0
    const settleTimers: number[] = []
    const scrollToAnnotation = (annotation: HTMLElement) => annotation.scrollIntoView({ block: 'center', inline: 'nearest' })
    const reveal = () => {
      const slotElement = diffPane.current?.querySelector<HTMLElement>(`[slot="${slot}"]`)
      const annotation = slotElement?.querySelector<HTMLElement>('[data-diff-annotation-target]') || slotElement
      if (annotation) {
        scrollToAnnotation(annotation)
        for (const delay of [250, 750]) settleTimers.push(window.setTimeout(() => scrollToAnnotation(annotation), delay))
        return
      }
      attempts += 1
      if (attempts < 30) timer = window.setTimeout(reveal, 100)
    }
    timer = window.setTimeout(reveal, 100)
    return () => {
      window.clearTimeout(timer)
      for (const settleTimer of settleTimers) window.clearTimeout(settleTimer)
    }
  }, [file?.path, fileAnnotations, preferredPath, preferredTarget?.line, preferredTarget?.side])

  function codeScrollers() {
    const host = diffPane.current?.querySelector('diffs-container')
    return host?.shadowRoot ? Array.from(host.shadowRoot.querySelectorAll<HTMLElement>('[data-code]')) : []
  }

  function scrollHorizontally(amount: number) {
    for (const scroller of codeScrollers()) scroller.scrollBy({ left: amount, behavior: 'smooth' })
  }

  function forwardHorizontalWheel(event: React.WheelEvent<HTMLDivElement>) {
    const horizontal = event.deltaX || (event.shiftKey ? event.deltaY : 0)
    if (!horizontal) return
    const scrollers = codeScrollers()
    if (!scrollers.length) return
    event.preventDefault()
    for (const scroller of scrollers) scroller.scrollLeft += horizontal
  }

  function discardDrafts() {
    setEditing(false)
    setDirtyFiles(new Set())
    setHistory({ canUndo: false, canRedo: false })
    editor.current = null
    originalContents.current.clear()
    setDraftRevision((current) => current + 1)
  }

  if (!patch || !file) return <div className="py-12 text-center text-sm text-muted-foreground">No file changes recorded yet.</div>

  return (
    <div className="grid min-h-0 min-w-0 max-w-full gap-3 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
      <ScrollArea className="hidden max-h-28 rounded-lg border bg-background sm:block sm:max-h-48 lg:max-h-[62vh]">
        <DiffFileTree annotations={annotations} files={files} onSelect={setSelected} selectedIndex={index} />
      </ScrollArea>

      <div className="min-w-0 max-w-full overflow-hidden">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-2">
          <div className="flex min-w-0 items-center gap-1">
            <Button variant="outline" size="icon-sm" disabled={index === 0} onClick={() => setSelected(index - 1)}>
              <ChevronLeft />
              <span className="sr-only">Previous file</span>
            </Button>
            <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-mono text-xs" title={file.path}>
              {index + 1}/{files.length} · {file.path}
            </span>
            <Button variant="outline" size="icon-sm" disabled={index === files.length - 1} onClick={() => setSelected(index + 1)}>
              <ChevronRight />
              <span className="sr-only">Next file</span>
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            {onAddToChat && (
              <div className="flex items-center rounded-md border bg-muted/30 p-0.5" role="group" aria-label="Diff mode">
                <Button variant={editing ? 'ghost' : 'secondary'} size="xs" aria-pressed={!editing} onClick={() => setEditing(false)}>
                  <Eye />
                  Review
                </Button>
                <Button variant={editing ? 'secondary' : 'ghost'} size="xs" aria-pressed={editing} onClick={() => setEditing(true)}>
                  <PencilLine />
                  Edit
                </Button>
              </div>
            )}
            {editing && (
              <div className="flex items-center gap-1" aria-label="Edit history">
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={!history.canUndo}
                  onClick={() => editor.current?.undo()}
                  title="Undo edit"
                >
                  <Undo2 />
                  <span className="sr-only">Undo edit</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={!history.canRedo}
                  onClick={() => editor.current?.redo()}
                  title="Redo edit"
                >
                  <Redo2 />
                  <span className="sr-only">Redo edit</span>
                </Button>
                {dirtyFiles.size > 0 && (
                  <Button variant="ghost" size="icon-sm" onClick={discardDrafts} title="Discard all draft edits">
                    <RotateCcw />
                    <span className="sr-only">Discard all draft edits</span>
                  </Button>
                )}
              </div>
            )}
            {!wrap && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon-sm" onClick={() => scrollHorizontally(-320)} title="Scroll diff left">
                  <ArrowLeft />
                  <span className="sr-only">Scroll diff left</span>
                </Button>
                <Button variant="outline" size="icon-sm" onClick={() => scrollHorizontally(320)} title="Scroll diff right">
                  <ArrowRight />
                  <span className="sr-only">Scroll diff right</span>
                </Button>
              </div>
            )}
            <Select value={style} onValueChange={(value) => setStyle(value as 'unified' | 'split')}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unified">Unified</SelectItem>
                <SelectItem value="split">Split</SelectItem>
              </SelectContent>
            </Select>
            <Label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={wrap} onCheckedChange={(value) => setWrap(Boolean(value))} />
              Wrap lines
            </Label>
          </div>
        </div>
        {onLineComment && (
          <p className="mb-2 text-xs text-muted-foreground">Select a changed line number to leave a GitHub inline comment.</p>
        )}
        {onAddToChat && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-blue-500/20 bg-blue-500/[.04] px-2.5 py-2 text-xs text-muted-foreground">
            <MessageSquarePlus className="mt-0.5 size-3.5 shrink-0 text-blue-400" />
            <span>
              {editing
                ? `Draft only${dirtyFiles.size ? ` · ${dirtyFiles.size} changed ${dirtyFiles.size === 1 ? 'file' : 'files'}` : ''}. Select code and choose Add to chat.`
                : 'Switch to Edit to adjust code, then select the exact context to add to the agent message.'}
            </span>
          </div>
        )}
        <div
          ref={diffPane}
          onWheel={forwardHorizontalWheel}
          className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border bg-background"
        >
          {fileDiff ? (
            <DiffEditProvider>
              {({ ready, error }) => (
                <>
                  <FileDiff<T>
                    className="block w-full min-w-0 max-w-full touch-auto"
                    fileDiff={fileDiff}
                    options={options}
                    edit={editing && ready}
                    editorOptions={editorOptions}
                    lineAnnotations={fileAnnotations}
                    renderAnnotation={(annotation) => renderAnnotation?.(annotation.metadata as T)}
                  />
                  {editing && !ready && (
                    <div className="border-t px-3 py-2 text-xs text-muted-foreground">{error || 'Loading the editor…'}</div>
                  )}
                </>
              )}
            </DiffEditProvider>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">This file cannot be rendered.</div>
          )}
        </div>
      </div>
    </div>
  )
}

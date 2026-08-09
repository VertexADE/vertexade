import { useEffect, useMemo, useRef, useState } from 'react'
import { File, type FileOptions } from '@pierre/diffs/react'
import type { Editor, EditorOptions } from '@pierre/diffs/edit'
import { ExternalLink, Eye, FileCode2, MessageSquarePlus, PencilLine, Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { toast } from 'sonner'

import { createAddToChatAction } from '@vertexade/ui/components/diff-chat-action'
import { DiffEditProvider } from '@vertexade/ui/components/diff-edit-provider'
import type { FileReference } from '@vertexade/ui/components/markdown-content'
import { Button, buttonVariants } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { api } from '@vertexade/ui/lib/dashboard-api'
import { sourcePathForWorktree, type ChatCodeSelection } from '@vertexade/ui/lib/code-selection'

type SourceFile = { path: string; line: number; line_count: number; content: string }

const sourceCSS = `
  [data-code] {
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x pan-y;
  }
`

export function SourceFileDialog({
  jobId,
  worktreePath,
  reference,
  onOpenChange,
  onAddToChat,
}: {
  jobId: number
  worktreePath: string
  reference: FileReference | null
  onOpenChange: (open: boolean) => void
  onAddToChat?: (selection: ChatCodeSelection) => void
}) {
  const [file, setFile] = useState<SourceFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftRevision, setDraftRevision] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
  const source = useRef<HTMLDivElement>(null)
  const editor = useRef<Editor<never> | null>(null)
  const scrolledReference = useRef('')

  useEffect(() => {
    if (!reference) return
    let active = true
    setLoading(true)
    setFile(null)
    setEditing(false)
    setDirty(false)
    setHistory({ canUndo: false, canRedo: false })
    setDraftRevision(0)
    editor.current = null
    scrolledReference.current = ''
    const sourcePath = sourcePathForWorktree(reference.path, worktreePath)
    api<SourceFile>(`/api/agent-threads/${jobId}/file?path=${encodeURIComponent(sourcePath)}&line=${reference.line}`)
      .then((value) => {
        if (active) setFile(value)
      })
      .catch((error) => toast.error(error.message))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [jobId, reference, worktreePath])

  const fileModel = useMemo(
    () =>
      file
        ? {
            name: file.path,
            contents: file.content,
            cacheKey: `thread-${jobId}:${file.path}:draft-${draftRevision}`,
          }
        : null,
    [draftRevision, file, jobId],
  )
  const options = useMemo<FileOptions<never> | undefined>(
    () =>
      file
        ? {
            theme: 'pierre-dark',
            themeType: 'dark',
            disableFileHeader: true,
            overflow: 'scroll',
            unsafeCSS: sourceCSS,
            onPostRender: () => {
              const key = `${file.path}:${file.line}`
              if (scrolledReference.current === key) return
              requestAnimationFrame(() => {
                const host = source.current?.querySelector('diffs-container')
                const line = host?.shadowRoot?.querySelector<HTMLElement>(`[data-line="${file.line}"]`)
                if (!line) return
                line.scrollIntoView({ block: 'center' })
                scrolledReference.current = key
              })
            },
          }
        : undefined,
    [file],
  )
  const editorOptions = useMemo<EditorOptions<never> | undefined>(
    () =>
      onAddToChat
        ? {
            enabledSelectionAction: true,
            persistState: true,
            renderSelectionAction: createAddToChatAction<never>(onAddToChat, file?.path),
            onAttach: (value) => {
              editor.current = value
              setHistory({ canUndo: value.canUndo, canRedo: value.canRedo })
            },
            onChange: () => {
              setDirty(Boolean(editor.current?.canUndo))
              setHistory({ canUndo: Boolean(editor.current?.canUndo), canRedo: Boolean(editor.current?.canRedo) })
            },
          }
        : undefined,
    [file?.path, onAddToChat],
  )

  const absolutePath = file ? `${worktreePath.replace(/\/$/, '')}/${file.path}` : ''
  const editorUrl = file ? `vscode://file${encodeURI(absolutePath)}:${file.line}` : '#'

  function discardDraft() {
    setEditing(false)
    setDirty(false)
    setHistory({ canUndo: false, canRedo: false })
    editor.current = null
    setDraftRevision((current) => current + 1)
  }

  return (
    <Dialog open={Boolean(reference)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col overflow-hidden p-0 sm:h-[min(88dvh,900px)] sm:max-w-6xl">
        <DialogHeader className="mx-0 mt-0 shrink-0 border-b px-4 py-3 pr-12">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-sm">
            <FileCode2 className="size-4 shrink-0" />
            <span className="truncate">{file?.path || reference?.path}</span>
            {reference && <span className="shrink-0 text-muted-foreground">:{reference.line}</span>}
          </DialogTitle>
          <DialogDescription className="line-clamp-2 break-all">
            {file ? `${file.line_count} lines · ${worktreePath}` : 'Opening referenced worktree file…'}
          </DialogDescription>
        </DialogHeader>
        {file && onAddToChat && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/10 px-3 py-2 sm:px-4">
            <div className="flex items-center rounded-md border bg-background p-0.5" role="group" aria-label="File mode">
              <Button variant={editing ? 'ghost' : 'secondary'} size="xs" aria-pressed={!editing} onClick={() => setEditing(false)}>
                <Eye />
                Review
              </Button>
              <Button variant={editing ? 'secondary' : 'ghost'} size="xs" aria-pressed={editing} onClick={() => setEditing(true)}>
                <PencilLine />
                Edit
              </Button>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="hidden items-center gap-1.5 truncate text-xs text-muted-foreground sm:flex">
                <MessageSquarePlus className="size-3.5 text-blue-400" />
                {editing
                  ? dirty
                    ? 'Draft changed · select code to add it to chat'
                    : 'Draft only · select code to add it to chat'
                  : 'Review mode'}
              </span>
              {editing && (
                <>
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
                  {dirty && (
                    <Button variant="ghost" size="icon-sm" onClick={discardDraft} title="Discard draft edits">
                      <RotateCcw />
                      <span className="sr-only">Discard draft edits</span>
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        <div ref={source} className="min-h-0 flex-1 overflow-auto bg-[#090b0e]">
          {loading && <p className="p-8 text-center text-sm text-muted-foreground">Loading file…</p>}
          {fileModel && (
            <DiffEditProvider>
              {({ ready, error }) => (
                <>
                  <File<never>
                    file={fileModel}
                    options={options}
                    edit={editing && ready}
                    editorOptions={editorOptions}
                    selectedLines={editing ? undefined : { start: file!.line, end: file!.line }}
                    className="block min-h-full min-w-0 touch-auto"
                  />
                  {editing && !ready && (
                    <p className="border-t px-4 py-2 text-xs text-muted-foreground">{error || 'Loading the editor…'}</p>
                  )}
                </>
              )}
            </DiffEditProvider>
          )}
        </div>
        <DialogFooter className="mx-0 mb-0 flex-row border-t px-4 py-3 [&>*]:w-auto">
          <a href={editorUrl} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <ExternalLink />
            Open in VS Code
          </a>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

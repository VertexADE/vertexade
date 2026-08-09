import { useCallback, useEffect, useState } from 'react'
import { ArrowRightLeft, Brain, Copy, Loader2, Pencil, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { MarkdownContent } from '@vertexade/ui/components/markdown-content'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem, WorkMemory } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

export function WorkMemoryCard({ item, revision }: { item: WorkItem; revision: number }) {
  const [memory, setMemory] = useState<WorkMemory | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const loadMemory = useCallback(async () => {
    setLoading(true)
    try {
      const value = await api<WorkMemory>(`/api/work-items/${item.id}/memory`)
      setMemory(value)
      if (!editing) setDraft(value.content)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [editing, item.id])
  useEffect(() => {
    void loadMemory()
  }, [loadMemory, revision])
  async function save() {
    setSaving(true)
    try {
      const value = await api<WorkMemory>(`/api/work-items/${item.id}/memory`, {
        method: 'PATCH',
        body: JSON.stringify({ content: draft }),
      })
      setMemory(value)
      setDraft(value.content)
      setEditing(false)
      toast.success('Shared Work memory saved')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const draftBytes = new Blob([draft]).size
  const copyPath = async () => {
    if (!memory?.path) return
    await navigator.clipboard.writeText(memory.path)
    toast.success('Memory path copied')
  }
  return (
    <Card id="memory" className="scroll-mt-32">
      <CardHeader className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Brain className="size-4 text-cyan-400" />
            Shared Work memory
          </CardTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">Every linked agent reads and can update this same file.</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:gap-1">
          <Button
            className="h-11 sm:h-7"
            variant="ghost"
            size="sm"
            aria-label="Refresh shared memory"
            disabled={loading}
            onClick={() => void loadMemory()}
          >
            <RefreshCw className={cn(loading && 'animate-spin')} />
            Refresh
          </Button>
          {editing ? (
            <Button className="h-11 sm:h-7" size="sm" disabled={saving || draftBytes > 200_000} onClick={() => void save()}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}Save
            </Button>
          ) : (
            <Button
              className="h-11 sm:h-7"
              variant="outline"
              size="sm"
              disabled={!memory}
              onClick={() => {
                setDraft(memory?.content || '')
                setEditing(true)
              }}
            >
              <Pencil />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              maxLength={200_000}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-[45dvh] font-mono text-xs sm:min-h-64"
            />{' '}
            <div className="flex flex-col gap-2 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span className={cn(draftBytes > 200_000 && 'text-red-400')}>{draftBytes.toLocaleString()} / 200,000 bytes</span>
              <Button
                className="h-11 sm:h-6"
                variant="ghost"
                size="xs"
                onClick={() => {
                  setDraft(memory?.content || '')
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : loading && !memory ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 inline size-4 animate-spin" />
            Loading shared memory…
          </p>
        ) : (
          <>
            <details className="group mb-3 rounded-lg border bg-muted/20">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-[11px] font-medium text-muted-foreground">
                <span>Memory file location</span>
                <span className="text-blue-400 group-open:hidden">Show</span>
                <span className="hidden text-blue-400 group-open:inline">Hide</span>
              </summary>
              <div className="border-t p-2.5">
                <code className="block break-all text-[11px] text-muted-foreground">{memory?.path}</code>
                <Button
                  className="mt-2 h-10 w-full sm:h-7 sm:w-auto"
                  variant="outline"
                  size="sm"
                  disabled={!memory?.path}
                  onClick={() => void copyPath()}
                >
                  <Copy />
                  Copy path
                </Button>
              </div>
            </details>
            {memory?.content ? (
              <MarkdownContent content={memory.content} />
            ) : (
              <p className="text-xs text-muted-foreground">The shared memory is empty.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function ContextTransfers({ item, onOpen }: { item: WorkItem; onOpen: (jobId: number) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowRightLeft className="size-4 text-cyan-400" />
          Cross-worktree handoff
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {item.context_transfers.map((transfer) => (
          <div key={transfer.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-xs">Transfer #{transfer.id}</strong>
              <Badge variant="outline" className="capitalize">
                {transfer.status}
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {transfer.source_job_id && (
                <Button className="h-11 sm:h-7" variant="outline" size="sm" onClick={() => onOpen(transfer.source_job_id!)}>
                  Source thread #{transfer.source_job_id}
                </Button>
              )}
              {transfer.destination_job_id && (
                <Button className="h-11 sm:h-7" size="sm" onClick={() => onOpen(transfer.destination_job_id!)}>
                  Destination thread #{transfer.destination_job_id}
                </Button>
              )}
            </div>
            {transfer.error && <p className="mt-2 text-xs text-red-400">{transfer.error}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { ChoiceItem, ChoiceItemContent, ChoiceItemDescription, ChoiceItemTitle, ChoiceList } from '@vertexade/ui/components/ui/choice-list'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Input } from '@vertexade/ui/components/ui/input'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { WorkBatchDeletionPreview, WorkBatchDeletionResult, WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { batchDeleteConfirmation, summarizeBatchDeletion } from './work-batch-delete'

const maximumSelection = 100

type BatchDeleteDialogProps = {
  items: WorkItem[]
  initialSelectedIds?: readonly number[]
  open: boolean
  onOpenChange(open: boolean): void
  onDeleted(): void
}

export function BatchDeleteWorkDialog({ items, initialSelectedIds = [], open, onOpenChange, onDeleted }: BatchDeleteDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialSelectedIds.slice(0, maximumSelection)))
  const [preview, setPreview] = useState<WorkBatchDeletionPreview | null>(null)
  const [result, setResult] = useState<WorkBatchDeletionResult | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected])

  useEffect(() => {
    if (open) return
    setSelected(new Set())
    setPreview(null)
    setResult(null)
    setConfirmation('')
    setBusy(false)
  }, [open])

  function toggle(id: number, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked && next.size < maximumSelection) next.add(id)
      else if (!checked) next.delete(id)
      return next
    })
  }

  async function review() {
    setBusy(true)
    try {
      const value = await api<WorkBatchDeletionPreview>('/api/work-items/delete-preview', {
        method: 'POST',
        body: JSON.stringify({ work_item_ids: selectedItems.map((item) => item.id) }),
      })
      setPreview(value)
      setConfirmation('')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!preview) return
    setBusy(true)
    try {
      const value = await api<WorkBatchDeletionResult>('/api/work-items', {
        method: 'DELETE',
        body: JSON.stringify({
          confirmed: true,
          work_item_ids: preview.items.map((item) => item.work_item.id),
        }),
      })
      onDeleted()
      if (!value.failed) {
        toast.success(`${value.deleted} Work item${value.deleted === 1 ? '' : 's'} permanently deleted`)
        onOpenChange(false)
        return
      }
      setResult(value)
      toast.error(`${value.deleted} deleted; ${value.failed} need attention`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const expectedConfirmation = batchDeleteConfirmation(preview?.items.length || 0)
  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="overflow-x-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <Trash2 className="size-5" />
            Delete Work items
          </DialogTitle>
          <DialogDescription>{batchDeletionDescription(result, preview)}</DialogDescription>
        </DialogHeader>
        <BatchDeletionBody
          items={items}
          selected={selected}
          preview={preview}
          result={result}
          confirmation={confirmation}
          onToggle={toggle}
          onConfirmationChange={setConfirmation}
          onSelectAll={() => setSelected(new Set(items.slice(0, maximumSelection).map((item) => item.id)))}
        />
        <BatchDeletionActions
          busy={busy}
          selectedCount={selected.size}
          preview={preview}
          result={result}
          confirmed={confirmation === expectedConfirmation}
          onBack={() => setPreview(null)}
          onClose={() => onOpenChange(false)}
          onReview={review}
          onRemove={remove}
        />
      </DialogContent>
    </Dialog>
  )
}

function batchDeletionDescription(result: WorkBatchDeletionResult | null, preview: WorkBatchDeletionPreview | null) {
  if (result) return 'Some cleanup needs attention before those Work items can disappear.'
  if (preview) return 'Review the combined local impact, then confirm once.'
  return 'Choose outcomes from the current view. Up to 100 can be removed at once.'
}

function BatchDeletionBody({
  items,
  selected,
  preview,
  result,
  confirmation,
  onToggle,
  onConfirmationChange,
  onSelectAll,
}: {
  items: WorkItem[]
  selected: Set<number>
  preview: WorkBatchDeletionPreview | null
  result: WorkBatchDeletionResult | null
  confirmation: string
  onToggle(id: number, checked: boolean): void
  onConfirmationChange(value: string): void
  onSelectAll(): void
}) {
  if (result) return <BatchDeletionFailures result={result} />
  if (preview) return <BatchDeletionReview preview={preview} confirmation={confirmation} onConfirmationChange={onConfirmationChange} />
  return <BatchDeletionSelection items={items} selected={selected} onToggle={onToggle} onSelectAll={onSelectAll} />
}

function BatchDeletionActions({
  busy,
  selectedCount,
  preview,
  result,
  confirmed,
  onBack,
  onClose,
  onReview,
  onRemove,
}: {
  busy: boolean
  selectedCount: number
  preview: WorkBatchDeletionPreview | null
  result: WorkBatchDeletionResult | null
  confirmed: boolean
  onBack(): void
  onClose(): void
  onReview(): void
  onRemove(): void
}) {
  if (result)
    return (
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    )
  if (preview)
    return (
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onBack}>
          Back
        </Button>
        <Button variant="destructive" loading={busy} loadingText="Deleting selected Work…" disabled={!confirmed} onClick={onRemove}>
          <Trash2 />
          Delete {preview.items.length} permanently
        </Button>
      </DialogFooter>
    )
  return (
    <DialogFooter>
      <Button variant="outline" disabled={busy} onClick={onClose}>
        Cancel
      </Button>
      <Button variant="destructive" loading={busy} loadingText="Calculating impact…" disabled={!selectedCount} onClick={onReview}>
        Review {selectedCount || ''} selected
      </Button>
    </DialogFooter>
  )
}

function BatchDeletionSelection({
  items,
  selected,
  onToggle,
  onSelectAll,
}: {
  items: WorkItem[]
  selected: Set<number>
  onToggle(id: number, checked: boolean): void
  onSelectAll(): void
}) {
  if (!items.length) return <p className="py-8 text-center text-xs text-muted-foreground">No Work matches the current filters.</p>
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{selected.size} selected</span>
        <Button variant="ghost" size="xs" onClick={onSelectAll}>
          Select all in view
        </Button>
      </div>
      <ChoiceList className="min-w-0 max-w-full overflow-x-hidden" scrollable aria-label="Completed Work items">
        {items.map((item) => {
          const id = `batch-delete-${item.id}`
          const checked = selected.has(item.id)
          return (
            <ChoiceItem key={item.id} className="min-w-0" htmlFor={id}>
              <Checkbox
                id={id}
                checked={checked}
                disabled={!checked && selected.size >= maximumSelection}
                onCheckedChange={(value) => onToggle(item.id, Boolean(value))}
              />
              <ChoiceItemContent>
                <ChoiceItemTitle>
                  {item.key} · {item.title}
                </ChoiceItemTitle>
                <ChoiceItemDescription className="truncate">
                  {item.threads.length} thread{item.threads.length === 1 ? '' : 's'} · {item.repository_names.join(', ') || 'No repository'}
                </ChoiceItemDescription>
              </ChoiceItemContent>
            </ChoiceItem>
          )
        })}
      </ChoiceList>
    </div>
  )
}

function BatchDeletionReview({
  preview,
  confirmation,
  onConfirmationChange,
}: {
  preview: WorkBatchDeletionPreview
  confirmation: string
  onConfirmationChange(value: string): void
}) {
  const totals = summarizeBatchDeletion(preview.items)
  const expected = batchDeleteConfirmation(preview.items.length)
  const metrics = [
    ['Work items', totals.items],
    ['Threads', totals.threads],
    ['Worktrees', totals.worktrees],
    ['Local branches', totals.branches],
    ['Logs', totals.logs],
    ...(totals.retainedLogs ? ([['Retained logs', totals.retainedLogs]] as const) : []),
    ['Memory files', totals.memories],
  ] as const
  return (
    <div className="min-w-0 space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-muted/25 p-3">
            <strong className="block font-mono text-lg">{value}</strong>
            <span className="text-[11px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
      <ActiveThreadWarning count={totals.activeThreads} />
      <PreservedAssets pullRequestCount={totals.preservedPullRequests.length} />
      <RetainedLocalAssets worktrees={totals.retainedWorktrees} branches={totals.retainedBranches} />
      <div>
        <label htmlFor="batch-delete-confirmation" className="text-xs font-medium">
          Type <span className="font-mono text-red-300">{expected}</span> to confirm
        </label>
        <Input
          id="batch-delete-confirmation"
          className="mt-2"
          value={confirmation}
          autoComplete="off"
          placeholder={expected}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
      </div>
    </div>
  )
}

function ActiveThreadWarning({ count }: { count: number }) {
  if (!count) return null
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[.05] p-3 text-xs text-amber-200">
      <AlertTriangle className="mr-2 inline size-4" />
      {count} active thread{count === 1 ? '' : 's'} will be stopped first.
    </div>
  )
}

function PreservedAssets({ pullRequestCount }: { pullRequestCount: number }) {
  return (
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[.05] p-3 text-xs text-muted-foreground">
      <ShieldCheck className="mr-2 inline size-4 text-emerald-400" />
      Repositories, remote branches, cached PR records, and {pullRequestCount} linked pull request{pullRequestCount === 1 ? '' : 's'} stay
      intact.
    </div>
  )
}

function RetainedLocalAssets({ worktrees, branches }: { worktrees: number; branches: number }) {
  if (!worktrees && !branches) return null
  return (
    <p className="text-xs text-muted-foreground">
      Shared or unmanaged assets retained: {worktrees} worktrees and {branches} local branches.
    </p>
  )
}

function BatchDeletionFailures({ result }: { result: WorkBatchDeletionResult }) {
  const failures = result.results.filter((entry) => !entry.deleted)
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center gap-2 rounded-lg border bg-muted/25 p-3 text-xs">
        <CheckCircle2 className="size-4 text-emerald-400" />
        {result.deleted} of {result.requested} Work items deleted.
      </div>
      <ChoiceList className="min-w-0 max-w-full overflow-x-hidden" scrollable aria-label="Batch deletion failures">
        {failures.map((entry) => (
          <div key={entry.work_item_key} className="px-3 py-3">
            <strong className="block text-xs">{entry.work_item_key}</strong>
            <p className="mt-1 text-[11px] text-red-300">
              {entry.errors.map((error) => `${error.target}: ${error.error}`).join(' · ') || 'Cleanup is incomplete'}
            </p>
          </div>
        ))}
      </ChoiceList>
    </div>
  )
}

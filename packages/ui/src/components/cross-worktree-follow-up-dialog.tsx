import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, GitBranch, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { JobLog, WorkItem } from '@vertexade/ui/lib/dashboard-types'

type Target = {
  id: number
  status: string
  kind: string
  agent_id: string
  task_title: string | null
  branch_name: string | null
  worktree_path: string
  work_item_id: number
  work_item_key: string
  work_item_title: string
  full_name: string
}

export function CrossWorktreeFollowUpDialog({ source, onOpenChange }: { source: JobLog | null; onOpenChange(open: boolean): void }) {
  const [targets, setTargets] = useState<Target[]>([])
  const [destination, setDestination] = useState('')
  const [title, setTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const selected = useMemo(() => targets.find((target) => String(target.id) === destination), [destination, targets])

  useEffect(() => {
    if (!source) return
    let active = true
    setTargets([])
    setDestination('')
    setTitle('')
    setInstruction('')
    setLoading(true)
    api<{ targets: Target[] }>(`/api/work-context-targets?source_job_id=${source.id}`)
      .then((result) => {
        if (active) setTargets(result.targets)
      })
      .catch((error) => toast.error(error.message))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [source?.id])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!source?.work_item_id || !destination || !title.trim() || !instruction.trim()) return
    setSending(true)
    try {
      const result = await api<{ workItem: WorkItem; destinationJobId: number }>(`/api/work-items/${source.work_item_id}/sub-items`, {
        method: 'POST',
        body: JSON.stringify({
          source_job_id: source.id,
          destination_job_id: Number(destination),
          title,
          instruction,
        }),
      })
      toast.success(`${result.workItem.key} started in run #${result.destinationJobId}`)
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Send output to another worktree</DialogTitle>
            <DialogDescription>
              A durable child work item will copy run #{source?.id}’s output into an existing idle run. The destination keeps its own
              branch, worktree, and history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="flex-col items-stretch gap-1.5">
              Destination run
              <Select value={destination} onValueChange={setDestination} disabled={loading}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={loading ? 'Finding available worktrees…' : 'Choose an existing run'} />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((target) => (
                    <SelectItem key={target.id} value={String(target.id)}>
                      {target.work_item_key} · {target.full_name} · run #{target.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            {!loading && !targets.length && (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No idle agent runs in another existing worktree are available.
              </p>
            )}
            {selected && (
              <div className="rounded-lg border bg-muted/20 p-3 text-xs">
                <strong>
                  {selected.work_item_key} · {selected.work_item_title}
                </strong>
                <p className="mt-1 text-muted-foreground">{selected.task_title || selected.full_name}</p>
                <p className="mt-2 flex items-center gap-1 break-all font-mono text-xs text-muted-foreground">
                  <GitBranch className="size-3 shrink-0" />
                  {selected.branch_name || selected.worktree_path}
                </p>
              </div>
            )}
            <Label className="flex-col items-stretch gap-1.5">
              Sub-item title
              <Input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What outcome should this handoff produce?"
              />
            </Label>
            <Label className="flex-col items-stretch gap-1.5">
              Follow-up instruction
              <Textarea
                required
                maxLength={20_000}
                className="min-h-32"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Explain how the destination run should use the source output."
              />
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={sending || loading || !destination || !title.trim() || !instruction.trim()}>
              {sending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}Create sub-item and send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

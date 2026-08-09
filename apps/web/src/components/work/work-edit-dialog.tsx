import { useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'

export function EditWorkDialog({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: WorkItem
  open: boolean
  onOpenChange(open: boolean): void
  onSaved(item: WorkItem): void
}) {
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description)
  const [priority, setPriority] = useState(item.priority)
  const [owner, setOwner] = useState(item.owner || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(item.title)
    setDescription(item.description)
    setPriority(item.priority)
    setOwner(item.owner || '')
  }, [item, open])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const updated = await api<WorkItem>(`/api/work-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          priority,
          owner: owner.trim(),
        }),
      })
      onSaved(updated)
      onOpenChange(false)
      toast.success(`${item.key} updated`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden sm:max-w-xl">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Refine outcome</DialogTitle>
            <DialogDescription>
              {item.key} · keep the durable outcome clear while agents and delivery evolve underneath it.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
            <div className="space-y-1.5">
              <Label htmlFor="work-edit-title">Outcome</Label>
              <Input
                id="work-edit-title"
                autoFocus
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What should be true when this is finished?"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="work-edit-description">Context and acceptance criteria</Label>
              <Textarea
                id="work-edit-description"
                className="min-h-40 resize-y"
                maxLength={20_000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe what good looks like, constraints, and the evidence needed to call this done."
              />
              <small className="block text-[11px] text-muted-foreground">
                Markdown is supported. Agent threads keep their own execution history.
              </small>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(value) => setPriority(value as WorkItem['priority'])}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="work-edit-owner">Owner</Label>
                <Input
                  id="work-edit-owner"
                  maxLength={200}
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  placeholder="Optional person or team"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={saving || !title.trim()}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? 'Saving…' : 'Save outcome'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

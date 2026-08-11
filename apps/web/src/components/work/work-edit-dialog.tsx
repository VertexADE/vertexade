import { useEffect } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (value: { title: string; description: string; priority: WorkItem['priority']; owner: string }) =>
      api<WorkItem>(`/api/work-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify(value),
      }),
  })
  const form = useForm({
    defaultValues: {
      title: item.title,
      description: item.description,
      priority: item.priority,
      owner: item.owner || '',
    },
    onSubmit: async ({ value }) => {
      const title = value.title.trim()
      if (!title) return
      try {
        const updated = await mutation.mutateAsync({
          title,
          description: value.description.trim(),
          priority: value.priority,
          owner: value.owner.trim(),
        })
        await queryClient.invalidateQueries({ queryKey: ['platform'] })
        onSaved(updated)
        onOpenChange(false)
        toast.success(`${item.key} updated`)
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      title: item.title,
      description: item.description,
      priority: item.priority,
      owner: item.owner || '',
    })
  }, [item, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden sm:max-w-xl">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader>
            <DialogTitle>Refine outcome</DialogTitle>
            <DialogDescription>
              {item.key} · keep the durable outcome clear while agents and delivery evolve underneath it.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
            <div className="space-y-1.5">
              <Label htmlFor="work-edit-title">Outcome</Label>
              <form.Field name="title" validators={{ onChange: ({ value }) => (value.trim() ? undefined : 'Outcome is required') }}>
                {(field) => (
                  <Input
                    id="work-edit-title"
                    autoFocus
                    maxLength={200}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="What should be true when this is finished?"
                  />
                )}
              </form.Field>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="work-edit-description">Context and acceptance criteria</Label>
              <form.Field name="description">
                {(field) => (
                  <Textarea
                    id="work-edit-description"
                    className="min-h-40 resize-y"
                    maxLength={20_000}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Describe what good looks like, constraints, and the evidence needed to call this done."
                  />
                )}
              </form.Field>
              <small className="block text-[11px] text-muted-foreground">
                Markdown is supported. Agent threads keep their own execution history.
              </small>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <form.Field name="priority">
                  {(field) => (
                    <Select value={field.state.value} onValueChange={(value) => field.handleChange(value as WorkItem['priority'])}>
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
                  )}
                </form.Field>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="work-edit-owner">Owner</Label>
                <form.Field name="owner">
                  {(field) => (
                    <Input
                      id="work-edit-owner"
                      maxLength={200}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="Optional person or team"
                    />
                  )}
                </form.Field>
              </div>
            </div>
          </div>
          <DialogFooter>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <>
                  <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? <Loader2 className="animate-spin" /> : <Save />}
                    {isSubmitting ? 'Saving…' : 'Save outcome'}
                  </Button>
                </>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

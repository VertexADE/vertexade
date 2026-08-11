import { useEffect } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { BookCheck, Bot, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type {
  DevelopmentConfidence,
  DevelopmentKnowledgeEntry,
  DevelopmentKnowledgeKind,
  DevelopmentKnowledgeScope,
} from '@vertexade/platform-contracts'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { api } from '@vertexade/ui/lib/dashboard-api'

export type KnowledgeDraft = {
  sourceJobId: number | null
  supersedesEntryId: number | null
  title: string
  summary: string
}

export function InvestigationDialog({
  open,
  onOpenChange,
  artifactPath,
  queryKey,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  artifactPath: string
  queryKey: QueryKey
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (question: string) =>
      api<{ id: number; work_item_id?: number | null }>(`${artifactPath}/agent-thread`, {
        method: 'POST',
        body: JSON.stringify({ question }),
      }),
  })
  const form = useForm({
    defaultValues: { question: '' },
    onSubmit: async ({ value }) => {
      try {
        const job = await mutation.mutateAsync(value.question.trim())
        await queryClient.invalidateQueries({ queryKey })
        onOpenChange(false)
        toast.success('Read-only investigation started')
        void navigate({ to: '/threads/$threadId', params: { threadId: String(job.id) } })
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })

  useEffect(() => {
    if (open) form.reset({ question: '' })
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Start a revision-bound investigation</DialogTitle>
            <DialogDescription>
              This creates a persistent investigation Work item and agent thread. The agent receives the immutable artifact, related
              evidence, and accepted repository knowledge in a strictly read-only workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">No file writes</Badge>
              <Badge variant="secondary">No branch or PR</Badge>
              <Badge variant="secondary">Output remains untrusted</Badge>
            </div>
            <Field>
              <FieldLabel htmlFor="development-investigation-question">Investigation question</FieldLabel>
              <form.Field name="question">
                {(field) => (
                  <Textarea
                    id="development-investigation-question"
                    className="min-h-36 resize-y"
                    maxLength={4_000}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Optional: focus the agent on a suspected dependency, ownership boundary, missing validation, architecture drift, or decision conflict."
                  />
                )}
              </form.Field>
              <FieldDescription>
                Leave this empty for a general evidence review. Findings become reusable only after an operator promotes them.
              </FieldDescription>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Bot data-icon="inline-start" />}
              {mutation.isPending ? 'Starting…' : 'Start investigation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function KnowledgePromotionDialog({
  open,
  onOpenChange,
  artifactPath,
  queryKey,
  draft,
  knowledge,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  artifactPath: string
  queryKey: QueryKey
  draft: KnowledgeDraft
  knowledge: DevelopmentKnowledgeEntry[]
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (value: {
      kind: DevelopmentKnowledgeKind
      scope: DevelopmentKnowledgeScope
      title: string
      summary: string
      path: string
      boundaryKey: string
      confidence: DevelopmentConfidence
    }) =>
      api<DevelopmentKnowledgeEntry>(`${artifactPath}/knowledge`, {
        method: 'POST',
        body: JSON.stringify({
          ...value,
          sourceJobId: draft.sourceJobId,
          supersedesEntryId: draft.supersedesEntryId,
          actor: 'operator',
        }),
      }),
  })
  const form = useForm({
    defaultValues: {
      kind: 'fact' as DevelopmentKnowledgeKind,
      scope: 'repository' as DevelopmentKnowledgeScope,
      title: draft.title,
      summary: draft.summary,
      path: '',
      boundaryKey: '',
      confidence: 'medium' as DevelopmentConfidence,
    },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync({
          ...value,
          title: value.title.trim(),
          summary: value.summary.trim(),
          path: value.path.trim(),
          boundaryKey: value.boundaryKey.trim(),
        })
        await queryClient.invalidateQueries({ queryKey })
        onOpenChange(false)
        toast.success(draft.supersedesEntryId ? 'Repository knowledge superseded' : 'Repository knowledge accepted')
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      kind: 'fact',
      scope: 'repository',
      title: draft.title,
      summary: draft.summary,
      path: '',
      boundaryKey: '',
      confidence: 'medium',
    })
  }, [draft, open])

  const superseded = draft.supersedesEntryId ? knowledge.find((entry) => entry.id === draft.supersedesEntryId) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{superseded ? `Supersede “${superseded.title}”` : 'Promote repository knowledge'}</DialogTitle>
            <DialogDescription>
              Review and rewrite the finding before accepting it. The stored entry keeps the artifact revision, digest, and optional
              investigation thread as provenance; agent output is never promoted automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            {draft.sourceJobId && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                This draft started from untrusted thread #{draft.sourceJobId}. Confirm every statement against the cited repository evidence
                before accepting it.
              </div>
            )}
            <FieldGroup className="sm:grid-cols-3">
              <Field>
                <FieldLabel>Kind</FieldLabel>
                <form.Field name="kind">
                  {(field) => (
                    <Select value={field.state.value} onValueChange={(value) => field.handleChange(value as DevelopmentKnowledgeKind)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(['fact', 'decision', 'constraint', 'risk', 'pattern', 'ownership'] as const).map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </form.Field>
              </Field>
              <Field>
                <FieldLabel>Scope</FieldLabel>
                <form.Field name="scope">
                  {(field) => (
                    <Select value={field.state.value} onValueChange={(value) => field.handleChange(value as DevelopmentKnowledgeScope)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="repository">repository</SelectItem>
                        <SelectItem value="path">path</SelectItem>
                        <SelectItem value="boundary">boundary</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </form.Field>
              </Field>
              <Field>
                <FieldLabel>Confidence</FieldLabel>
                <form.Field name="confidence">
                  {(field) => (
                    <Select value={field.state.value} onValueChange={(value) => field.handleChange(value as DevelopmentConfidence)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">high</SelectItem>
                        <SelectItem value="medium">medium</SelectItem>
                        <SelectItem value="low">low</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </form.Field>
              </Field>
            </FieldGroup>
            <Field>
              <FieldLabel htmlFor="development-knowledge-title">Knowledge title</FieldLabel>
              <form.Field name="title" validators={{ onChange: ({ value }) => (value.trim() ? undefined : 'Title is required') }}>
                {(field) => (
                  <Input
                    id="development-knowledge-title"
                    maxLength={200}
                    required
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="A durable, specific statement"
                  />
                )}
              </form.Field>
            </Field>
            <Field>
              <FieldLabel htmlFor="development-knowledge-summary">Reviewed knowledge</FieldLabel>
              <form.Field name="summary" validators={{ onChange: ({ value }) => (value.trim() ? undefined : 'Summary is required') }}>
                {(field) => (
                  <Textarea
                    id="development-knowledge-summary"
                    className="min-h-40 resize-y"
                    maxLength={10_000}
                    required
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="State what is known, why it matters, and the limits of the evidence."
                  />
                )}
              </form.Field>
            </Field>
            <form.Subscribe selector={(state) => state.values.scope}>
              {(scope) =>
                scope === 'path' ? (
                  <Field>
                    <FieldLabel htmlFor="development-knowledge-path">Repository-relative path</FieldLabel>
                    <form.Field name="path">
                      {(field) => (
                        <Input
                          id="development-knowledge-path"
                          required
                          maxLength={1_000}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                          placeholder="apps/api/src/server"
                        />
                      )}
                    </form.Field>
                  </Field>
                ) : scope === 'boundary' ? (
                  <Field>
                    <FieldLabel htmlFor="development-knowledge-boundary">Architecture boundary key</FieldLabel>
                    <form.Field name="boundaryKey">
                      {(field) => (
                        <Input
                          id="development-knowledge-boundary"
                          required
                          maxLength={500}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                          placeholder="architecture:service:apps/api"
                        />
                      )}
                    </form.Field>
                  </Field>
                ) : null
              }
            </form.Subscribe>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting || mutation.isPending}>
                  {mutation.isPending ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <BookCheck data-icon="inline-start" />
                  )}
                  {mutation.isPending ? 'Accepting…' : superseded ? 'Accept replacement' : 'Accept knowledge'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

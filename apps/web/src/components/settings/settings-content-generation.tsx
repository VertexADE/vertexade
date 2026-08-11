import { useEffect } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { Status, StatusPanel, StatusPanelContent, StatusPanelDescription, StatusPanelTitle } from '@vertexade/ui/components/ui/status'
import { api, type AgentLaunchOptions } from '@vertexade/ui/lib/dashboard-api'
import type { ContentGenerationSettings } from './settings-types'

const generationLaunchOptions = (settings: ContentGenerationSettings): AgentLaunchOptions => ({
  agentId: settings.agentId,
  model: settings.model,
  reasoningEffort: settings.reasoningEffort,
  serviceTier: settings.serviceTier || '',
  allowSubagents: false,
})

export function ContentGenerationDefaults({
  value,
  onSaved,
}: {
  value: ContentGenerationSettings
  onSaved: (value: ContentGenerationSettings) => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (options: AgentLaunchOptions) =>
      api<ContentGenerationSettings>('/api/settings/content-generation', {
        method: 'POST',
        body: JSON.stringify({
          agentId: options.agentId,
          model: options.model,
          reasoningEffort: options.reasoningEffort,
          serviceTier: options.serviceTier || '',
        }),
      }),
  })
  const form = useForm({
    defaultValues: { options: generationLaunchOptions(value) },
    onSubmit: async ({ value: formValue }) => {
      try {
        const saved = await mutation.mutateAsync(formValue.options)
        await queryClient.invalidateQueries({ queryKey: ['platform'] })
        onSaved(saved)
        toast.success('Read-only generation default saved')
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  useEffect(() => {
    form.reset({ options: generationLaunchOptions(value) })
  }, [form, value.agentId, value.model, value.reasoningEffort, value.serviceTier])
  return (
    <Card className="min-w-0" layout="divided">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles />
          Generated text
        </CardTitle>
        <CardDescription>
          Default provider, model, and reasoning level for lightweight titles, summaries, labels, and other generated metadata.
        </CardDescription>
        <CardAction>
          <Status tone="success">
            <ShieldCheck /> Read-only
          </Status>
        </CardAction>
      </CardHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <CardContent className="flex flex-col gap-4">
          <form.Field name="options">
            {(field) => <AgentOptionsPicker nativeOnly readOnlyOnly value={field.state.value} onChange={field.handleChange} />}
          </form.Field>
          <StatusPanel tone="success">
            <ShieldCheck />
            <StatusPanelContent>
              <StatusPanelTitle>Permission is fixed</StatusPanelTitle>
              <StatusPanelDescription>
                Metadata generation can inspect supplied context, but cannot edit source files or write to external services. This does not
                change normal work-agent defaults.
              </StatusPanelDescription>
            </StatusPanelContent>
          </StatusPanel>
        </CardContent>
        <CardFooter className="justify-end">
          <form.Subscribe selector={(state) => [state.isSubmitting, state.values.options.agentId] as const}>
            {([busy, agentId]) => (
              <Button size="sm" className="w-full shrink-0 sm:w-auto" disabled={busy || !agentId}>
                {busy && <Spinner data-icon="inline-start" />}
                {busy ? 'Saving…' : 'Save generation default'}
              </Button>
            )}
          </form.Subscribe>
        </CardFooter>
      </form>
    </Card>
  )
}

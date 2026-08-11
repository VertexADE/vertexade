import { useEffect } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Container } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { StatusPanel, StatusPanelContent, StatusPanelDescription, StatusPanelTitle } from '@vertexade/ui/components/ui/status'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { PreviewSettings } from './settings-types'

function previewSavedMessage(settings: PreviewSettings): string {
  if (!settings.domain) return 'Worktree preview gateway disabled'
  return `Preview gateway ready on *.${settings.domain}:${settings.gatewayPort}`
}

function PreviewGatewayPrerequisite({ domain, gatewayPort }: { domain: string; gatewayPort: string }) {
  const displayedDomain = domain || 'previews.example.com'
  const displayedPort = gatewayPort || '4180'
  return (
    <StatusPanel tone="info">
      <Container />
      <StatusPanelContent>
        <StatusPanelTitle>DNS prerequisite</StatusPanelTitle>
        <StatusPanelDescription>
          Point <code className="break-all">*.{displayedDomain}</code> to this VertexADE host and allow TCP port {displayedPort}. Each
          detected service receives its own hostname and internal <code>PORT</code> value.
        </StatusPanelDescription>
      </StatusPanelContent>
    </StatusPanel>
  )
}

function SavePreviewGatewayButton({ busy }: { busy: boolean }) {
  return (
    <Button size="sm" className="w-full shrink-0 sm:w-auto" disabled={busy}>
      {busy && <Spinner data-icon="inline-start" />}
      {busy ? 'Saving gateway…' : 'Save preview gateway'}
    </Button>
  )
}

export function WorktreePreviewSettings({ settings, onSaved }: { settings: PreviewSettings; onSaved: (value: PreviewSettings) => void }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (value: { domain: string; gatewayPort: number }) =>
      api<PreviewSettings>('/api/settings/worktree-previews', {
        method: 'POST',
        body: JSON.stringify(value),
      }),
  })
  const form = useForm({
    defaultValues: { domain: settings.domain, gatewayPort: String(settings.gatewayPort) },
    onSubmit: async ({ value }) => {
      try {
        const saved = await mutation.mutateAsync({ domain: value.domain.trim(), gatewayPort: Number(value.gatewayPort) })
        await queryClient.invalidateQueries({ queryKey: ['platform'] })
        onSaved(saved)
        toast.success(previewSavedMessage(saved))
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  useEffect(() => {
    form.reset({ domain: settings.domain, gatewayPort: String(settings.gatewayPort) })
  }, [settings.domain, settings.gatewayPort])
  return (
    <Card className="min-w-0" layout="divided">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Container />
          Worktree container previews
        </CardTitle>
        <CardDescription>
          Run PR and Work-item worktrees as isolated containers behind one wildcard-domain gateway. VertexADE detects Tilt, Compose,
          Dockerfiles, simple Moon tasks, and dependency-aware Moon application plus devtool environments.
        </CardDescription>
      </CardHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className="min-w-0"
      >
        <CardContent className="flex flex-col gap-4">
          <FieldGroup className="grid-cols-[minmax(0,1fr)_7rem] sm:grid-cols-[minmax(0,1fr)_9rem]">
            <Field>
              <FieldLabel htmlFor="preview-domain">Wildcard base domain</FieldLabel>
              <form.Field name="domain">
                {(field) => (
                  <Input
                    id="preview-domain"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    autoComplete="off"
                    placeholder="previews.example.com"
                  />
                )}
              </form.Field>
              <FieldDescription>Leave empty to disable container previews.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="preview-port">Gateway port</FieldLabel>
              <form.Field
                name="gatewayPort"
                validators={{
                  onChange: ({ value }) => {
                    const port = Number(value)
                    return Number.isInteger(port) && port >= 1024 && port <= 65_535 ? undefined : 'Use a port from 1024 to 65535'
                  },
                }}
              >
                {(field) => (
                  <Input
                    id="preview-port"
                    required
                    type="number"
                    min={1024}
                    max={65535}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
              </form.Field>
            </Field>
          </FieldGroup>
          <form.Subscribe selector={(state) => state.values}>
            {(value) => <PreviewGatewayPrerequisite domain={value.domain} gatewayPort={value.gatewayPort} />}
          </form.Subscribe>
        </CardContent>
        <CardFooter className="flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <p className="hidden min-w-0 text-[11px] text-muted-foreground sm:block">
            Repository files stay the source of truth; generated orchestration and Moon execution stay inside Docker.
          </p>
          <form.Subscribe selector={(state) => state.isSubmitting}>{(busy) => <SavePreviewGatewayButton busy={busy} />}</form.Subscribe>
        </CardFooter>
      </form>
    </Card>
  )
}

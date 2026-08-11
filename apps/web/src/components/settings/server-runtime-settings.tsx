import { useEffect } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe2, Network, RotateCcw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { StatusPanel, StatusPanelContent, StatusPanelDescription, StatusPanelTitle } from '@vertexade/ui/components/ui/status'
import { api } from '@vertexade/ui/lib/dashboard-api'
import { platformQueryKey } from '@vertexade/ui/lib/platform-query'

type ListenerStatus = {
  host: string
  port: number
  currentHost: string
  currentPort: number
  source: 'environment' | 'settings' | 'default'
  environmentOverride: boolean
}

type ServerRuntimeStatus = {
  web: ListenerStatus
  api: ListenerStatus
  restartRequired: boolean
}

type ListenerValues = {
  web: { host: string; port: number }
  api: { host: string; port: number }
}

type RuntimeSettingsValue = {
  status: ServerRuntimeStatus
  configuration: ListenerValues
}

function values(status: ServerRuntimeStatus): ListenerValues {
  return {
    web: { host: status.web.host, port: status.web.port },
    api: { host: status.api.host, port: status.api.port },
  }
}

function externallyBound(host: string) {
  return !['127.0.0.1', '::1', 'localhost'].includes(host.trim().toLowerCase())
}

function configurationExposed(configuration: ListenerValues) {
  return externallyBound(configuration.web.host) || externallyBound(configuration.api.host)
}

function ListenerFields({
  id,
  label,
  description,
  status,
  value,
  onChange,
}: {
  id: 'web' | 'api'
  label: string
  description: string
  status: ListenerStatus
  value: ListenerValues['web']
  onChange(value: ListenerValues['web']): void
}) {
  return (
    <FieldGroup className="rounded-lg border border-border/60 bg-background/45 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <strong className="text-sm">{label}</strong>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        </div>
        <Badge variant="outline">
          Current · {status.currentHost}:{status.currentPort}
        </Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <Field>
          <FieldLabel htmlFor={`${id}-host`}>Bind host</FieldLabel>
          <Input id={`${id}-host`} value={value.host} onChange={(event) => onChange({ ...value, host: event.target.value })} required />
          <FieldDescription>
            Use 127.0.0.1 for this machine, 0.0.0.0 for every IPv4 interface, or :: for every IPv6 interface.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-port`}>Port</FieldLabel>
          <Input
            id={`${id}-port`}
            type="number"
            min={1}
            max={65_535}
            value={value.port}
            onChange={(event) => onChange({ ...value, port: Number(event.target.value) })}
            required
          />
          <FieldDescription>Must not match the other listener.</FieldDescription>
        </Field>
      </div>
      {status.environmentOverride && (
        <p className="text-[11px] text-warning">
          The running process uses an environment override. This saved value takes effect only after that override is removed.
        </p>
      )}
    </FieldGroup>
  )
}

function useServerRuntimeSettings() {
  const queryClient = useQueryClient()
  const queryKey = platformQueryKey('/api/settings/server-runtime')
  const statusQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => api<ServerRuntimeStatus>('/api/settings/server-runtime', { signal }),
  })
  const mutation = useMutation({
    mutationFn: (configuration: ListenerValues) =>
      api<ServerRuntimeStatus>('/api/settings/server-runtime', {
        method: 'POST',
        body: JSON.stringify(configuration),
      }),
  })
  const form = useForm({
    defaultValues: {
      web: { host: '', port: 0 },
      api: { host: '', port: 0 },
    } satisfies ListenerValues,
    onSubmit: async ({ value }) => {
      try {
        const result = await mutation.mutateAsync(value)
        queryClient.setQueryData(queryKey, result)
        form.reset(values(result))
        toast.success(result.restartRequired ? 'Listener settings saved · restart this server to apply them' : 'Listener settings saved')
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  const formValues = useStore(form.store, (state) => state.values)
  const saving = useStore(form.store, (state) => state.isSubmitting)
  useEffect(() => {
    if (statusQuery.data) form.reset(values(statusQuery.data))
  }, [statusQuery.data])
  useEffect(() => {
    if (statusQuery.error) toast.error(statusQuery.error.message)
  }, [statusQuery.error])

  const update = (listener: keyof ListenerValues, value: ListenerValues['web']) => {
    form.setFieldValue(listener, value)
  }

  return {
    status: statusQuery.data ?? null,
    configuration: statusQuery.data ? formValues : null,
    saving,
    save: form.handleSubmit,
    update,
  }
}

function exposureDetails(exposed: boolean) {
  if (exposed) {
    return {
      tone: 'warning' as const,
      icon: ShieldAlert,
      title: 'Share only the authenticated web gateway',
      description:
        'The desktop web listener accepts paired devices. Keep the raw API on 127.0.0.1, and limit the shared web port to a trusted LAN or Tailscale network.',
    }
  }
  return {
    tone: 'info' as const,
    icon: Network,
    title: 'Loopback-only access',
    description: 'Both configured listeners are limited to this machine. Change a bind host only when another trusted device must connect.',
  }
}

function ExposureStatus({ exposed }: { exposed: boolean }) {
  const details = exposureDetails(exposed)
  const Icon = details.icon
  return (
    <StatusPanel tone={details.tone}>
      <Icon />
      <StatusPanelContent>
        <StatusPanelTitle>{details.title}</StatusPanelTitle>
        <StatusPanelDescription>{details.description}</StatusPanelDescription>
      </StatusPanelContent>
    </StatusPanel>
  )
}

function RestartStatus({ required }: { required: boolean }) {
  if (!required) return null
  return (
    <StatusPanel tone="warning">
      <RotateCcw />
      <StatusPanelContent>
        <StatusPanelTitle>Restart required</StatusPanelTitle>
        <StatusPanelDescription>
          The saved bindings differ from the running listeners. Restart this selected server with its normal service manager to apply them.
        </StatusPanelDescription>
      </StatusPanelContent>
    </StatusPanel>
  )
}

function RuntimeSettingsBody({
  value,
  onChange,
}: {
  value: RuntimeSettingsValue | null
  onChange(listener: keyof ListenerValues, value: ListenerValues['web']): void
}) {
  if (!value) {
    return (
      <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Reading listener settings…
      </div>
    )
  }
  const { status, configuration } = value
  return (
    <>
      <ExposureStatus exposed={configurationExposed(configuration)} />
      <ListenerFields
        id="web"
        label="Web application"
        description="The browser UI and same-origin API proxy. This is normally the only listener exposed to users."
        status={status.web}
        value={configuration.web}
        onChange={(value) => onChange('web', value)}
      />
      <ListenerFields
        id="api"
        label="API"
        description="The backend control plane. Keep this on loopback when the web application proxies all browser traffic."
        status={status.api}
        value={configuration.api}
        onChange={(value) => onChange('api', value)}
      />
      <RestartStatus required={status.restartRequired} />
    </>
  )
}

function runtimeSettingsValue(status: ServerRuntimeStatus | null, configuration: ListenerValues | null): RuntimeSettingsValue | null {
  if (!status) return null
  if (!configuration) return null
  return { status, configuration }
}

function SaveListenersButton({ ready, saving }: { ready: boolean; saving: boolean }) {
  return (
    <Button type="submit" disabled={!ready || saving}>
      {saving && <Spinner data-icon="inline-start" />}
      Save listeners
    </Button>
  )
}

export function ServerRuntimeSettings() {
  const settings = useServerRuntimeSettings()
  const value = runtimeSettingsValue(settings.status, settings.configuration)
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void settings.save()
  }

  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle>Network listeners</CardTitle>
        <CardDescription>Configure how this selected VertexADE server exposes its web application and API.</CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="flex flex-col gap-4">
          <RuntimeSettingsBody value={value} onChange={settings.update} />
        </CardContent>
        <CardFooter className="flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Globe2 />
            Settings are stored independently on this server.
          </span>
          <SaveListenersButton ready={Boolean(settings.configuration)} saving={settings.saving} />
        </CardFooter>
      </form>
    </Card>
  )
}

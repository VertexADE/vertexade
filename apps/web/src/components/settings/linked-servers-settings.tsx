import { useEffect } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Network, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { Status, StatusPanel, StatusPanelContent, StatusPanelDescription, StatusPanelTitle } from '@vertexade/ui/components/ui/status'
import { api } from '@vertexade/ui/lib/dashboard-api'
import { platformQueryKey } from '@vertexade/ui/lib/platform-query'

type LinkedServer = { id: string; label: string; url: string; namespace: number; enabled: boolean }

export function LinkedServersSettings() {
  const queryClient = useQueryClient()
  const queryKey = platformQueryKey('/api/settings/linked-servers')
  const serversQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => api<{ servers: LinkedServer[] }>('/api/settings/linked-servers', { signal }),
  })
  const addMutation = useMutation({
    mutationFn: (value: { id: string; label: string; url: string; operatorToken: string }) =>
      api('/api/settings/linked-servers', {
        method: 'POST',
        headers: value.operatorToken ? { authorization: `Bearer ${value.operatorToken}` } : undefined,
        body: JSON.stringify({ id: value.id, label: value.label, url: value.url }),
      }),
  })
  const form = useForm({
    defaultValues: { id: '', label: '', url: '', operatorToken: '' },
    onSubmit: async ({ value }) => {
      try {
        await addMutation.mutateAsync({
          id: value.id.trim(),
          label: value.label.trim(),
          url: value.url.trim(),
          operatorToken: value.operatorToken.trim(),
        })
        form.reset()
        await queryClient.invalidateQueries({ queryKey })
        toast.success('Server linked')
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
  })
  const servers = serversQuery.data?.servers ?? []
  const loading = serversQuery.isLoading

  useEffect(() => {
    if (serversQuery.error) toast.error(serversQuery.error.message)
  }, [serversQuery.error])

  async function updateServer(server: LinkedServer, patch: Partial<LinkedServer>) {
    try {
      await api(`/api/settings/linked-servers/${encodeURIComponent(server.id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
      await queryClient.invalidateQueries({ queryKey })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async function removeServer(server: LinkedServer) {
    try {
      await api(`/api/settings/linked-servers/${encodeURIComponent(server.id)}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey })
      toast.success(`${server.label} unlinked`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle>Server federation</CardTitle>
        <CardDescription>Add operator-approved VertexADE API origins to the unified workspace.</CardDescription>
        <CardAction>
          <Badge variant="secondary">Advanced</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <StatusPanel tone="info">
          <Network />
          <StatusPanelContent>
            <StatusPanelTitle>Public and private VertexADE servers</StatusPanelTitle>
            <StatusPanelDescription>
              Linking explicitly trusts this exact origin. The API verifies its VertexADE identity, pins DNS, and revalidates every
              redirect. Private origins require this server&apos;s operator API token.
            </StatusPanelDescription>
          </StatusPanelContent>
        </StatusPanel>
        <form
          className="rounded-lg border border-border/60 bg-muted/20 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <FieldGroup className="md:grid-cols-2 xl:grid-cols-[minmax(8rem,.7fr)_minmax(10rem,1fr)_minmax(14rem,1.5fr)_minmax(10rem,1fr)_auto]">
            <Field>
              <FieldLabel htmlFor="linked-server-id">Stable ID</FieldLabel>
              <form.Field
                name="id"
                validators={{
                  onChange: ({ value }) =>
                    /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(value) ? undefined : 'Use letters, numbers, underscore, or dash',
                }}
              >
                {(field) => (
                  <Input
                    id="linked-server-id"
                    required
                    placeholder="team"
                    pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,47}"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
              </form.Field>
            </Field>
            <Field>
              <FieldLabel htmlFor="linked-server-label">Display name</FieldLabel>
              <form.Field name="label" validators={{ onChange: ({ value }) => (value.trim() ? undefined : 'Name is required') }}>
                {(field) => (
                  <Input
                    id="linked-server-label"
                    required
                    placeholder="Team server"
                    maxLength={80}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
              </form.Field>
            </Field>
            <Field>
              <FieldLabel htmlFor="linked-server-url">API origin</FieldLabel>
              <form.Field name="url" validators={{ onChange: ({ value }) => (value.trim() ? undefined : 'Origin is required') }}>
                {(field) => (
                  <Input
                    id="linked-server-url"
                    type="url"
                    required
                    placeholder="http://192.168.1.10:4173"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
              </form.Field>
            </Field>
            <Field>
              <FieldLabel htmlFor="linked-server-token">Operator token</FieldLabel>
              <form.Field name="operatorToken">
                {(field) => (
                  <Input
                    id="linked-server-token"
                    type="password"
                    autoComplete="off"
                    placeholder="Private origins only"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
              </form.Field>
              <FieldDescription>Sent only while this link is created.</FieldDescription>
            </Field>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button className="self-end" type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                  {isSubmitting ? 'Linking…' : 'Link server'}
                </Button>
              )}
            </form.Subscribe>
          </FieldGroup>
        </form>
        <div className="flex flex-col gap-2">
          {servers.map((server) => (
            <div key={server.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-background/55 p-3">
              <Status tone={server.enabled ? 'success' : 'neutral'}>{server.enabled ? 'Enabled' : 'Disabled'}</Status>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{server.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {server.url} · {server.id}
                </span>
              </span>
              <Field className="flex w-auto grid-cols-[auto_1fr] items-center gap-2">
                <Checkbox
                  id={`linked-server-${server.id}`}
                  checked={server.enabled}
                  onCheckedChange={(checked) => void updateServer(server, { enabled: checked === true })}
                />
                <FieldLabel htmlFor={`linked-server-${server.id}`}>Use in workspace</FieldLabel>
              </Field>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Unlink ${server.label}`}
                onClick={() => void removeServer(server)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Spinner /> Loading servers…
            </div>
          )}
          {!servers.length && !loading && (
            <Empty className="min-h-36">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Network />
                </EmptyMedia>
                <EmptyTitle>No federated servers</EmptyTitle>
                <EmptyDescription>This desktop is using only its primary VertexADE server.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

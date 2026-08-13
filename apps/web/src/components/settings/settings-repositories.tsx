import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { FolderCog, FolderOpen, FolderPlus, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Field, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@vertexade/ui/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { age, backendApi } from '@vertexade/ui/lib/dashboard-api'
import { loadBackendRegistry, type BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { desktopBridge } from '../../lib/desktop-bridge'
import { RepositoryEnvironmentDialog } from './repository-environment-dialog'
import { ServerDirectoryBrowserDialog } from './server-directory-browser-dialog'
import { RepositorySearchPicker } from '@vertexade/ui/components/repository-search-picker'

type AddRepositoryInput = { repository: string } | { local_path: string; name?: string; workspace_strategy?: string }

export function Repositories({
  repositories,
  onAdd,
}: {
  repositories: Repository[]
  onAdd(input: AddRepositoryInput, backendId?: string): Promise<void>
}) {
  const [environmentRepo, setEnvironmentRepo] = useState<Repository | null>(null)
  const [choosingDirectory, setChoosingDirectory] = useState(false)
  const [bridge, setBridge] = useState<ReturnType<typeof desktopBridge>>(null)
  const [backends, setBackends] = useState<BackendDescriptor[]>([])
  const [browserOpen, setBrowserOpen] = useState(false)
  const [repositoryBackendId, setRepositoryBackendId] = useState('')
  useEffect(() => setBridge(desktopBridge()), [])
  useEffect(() => {
    void loadBackendRegistry()
      .then((result) => {
        setBackends(result.backends)
        setRepositoryBackendId(
          (current) => current || result.backends.find((backend) => backend.isDefault)?.id || result.backends[0]?.id || '',
        )
      })
      .catch(() => setBackends([]))
  }, [])
  const form = useForm({
    defaultValues: { repository: '' },
    onSubmit: async ({ value }) => {
      await onAdd({ repository: value.repository.trim() }, repositoryBackendId || undefined)
      form.reset()
    },
  })
  const localForm = useForm({
    defaultValues: { path: '', name: '', strategy: 'auto', backendId: '' },
    onSubmit: async ({ value }) => {
      await onAdd(
        {
          local_path: value.path.trim(),
          ...(value.name.trim() ? { name: value.name.trim() } : {}),
          ...(value.strategy === 'auto' ? {} : { workspace_strategy: value.strategy }),
        },
        value.backendId || undefined,
      )
      localForm.reset()
    },
  })
  async function sync(repo: Repository) {
    try {
      const result = await backendApi<{ open_prs: number }>(repo.backend_id, `/api/repositories/${repo.backend_local_id ?? repo.id}/sync`, {
        method: 'POST',
        body: '{}',
      })
      toast.success(`${repo.full_name}: ${result.open_prs} open PRs`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  async function chooseDirectory() {
    if (!bridge) return
    setChoosingDirectory(true)
    try {
      const path = await bridge.dialog.chooseDirectory()
      if (path) localForm.setFieldValue('path', path)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setChoosingDirectory(false)
    }
  }
  return (
    <>
      <Card className="min-w-0" layout="divided">
        <CardHeader>
          <CardTitle>Repositories</CardTitle>
          <CardDescription>Add a hosted Git repository or an existing directory on this server.</CardDescription>
        </CardHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
          className="grid min-w-0 gap-2 p-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end"
        >
          <Field>
            <FieldLabel>Server</FieldLabel>
            <Select value={repositoryBackendId} onValueChange={setRepositoryBackendId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Local" />
              </SelectTrigger>
              <SelectContent>
                {backends
                  .filter((backend) => backend.connected)
                  .map((backend) => (
                    <SelectItem key={backend.id} value={backend.id}>
                      {backend.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-add-repository">Add a GitHub repository</FieldLabel>
            <form.Field
              name="repository"
              validators={{
                onChange: ({ value }) => (value.trim() ? undefined : 'Repository is required'),
              }}
            >
              {(field) => (
                <Input
                  id="settings-add-repository"
                  required
                  placeholder="owner/repository or GitHub URL"
                  className="h-9 min-w-0"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
          </Field>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button size="sm" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? <RefreshCw className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                {isSubmitting ? 'Adding…' : 'Add repository'}
              </Button>
            )}
          </form.Subscribe>
          <div className="sm:col-start-2">
            <RepositorySearchPicker
              backendId={repositoryBackendId}
              added={repositories
                .filter((repository) => !repository.backend_id || repository.backend_id === repositoryBackendId)
                .map((repository) => repository.full_name)}
              onSelect={async (repository) => {
                await onAdd({ repository: repository.id }, repositoryBackendId || undefined)
              }}
            />
          </div>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void localForm.handleSubmit()
          }}
          className="grid min-w-0 gap-2 border-t p-3 sm:grid-cols-[10rem_minmax(0,1.4fr)_minmax(8rem,.6fr)_11rem_auto] sm:items-end"
        >
          <Field>
            <FieldLabel>Server</FieldLabel>
            <localForm.Field name="backendId">
              {(field) => (
                <Select
                  value={field.state.value || backends.find((backend) => backend.isDefault)?.id || ''}
                  onValueChange={field.handleChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Local" />
                  </SelectTrigger>
                  <SelectContent>
                    {backends
                      .filter((backend) => backend.connected)
                      .map((backend) => (
                        <SelectItem key={backend.id} value={backend.id}>
                          {backend.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </localForm.Field>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-add-local-directory">Local directory</FieldLabel>
            <localForm.Field
              name="path"
              validators={{
                onChange: ({ value }) => (value.trim() ? undefined : 'Directory is required'),
              }}
            >
              {(field) => (
                <InputGroup className="h-9">
                  <InputGroupInput
                    id="settings-add-local-directory"
                    required
                    placeholder="/absolute/path/to/project"
                    className="min-w-0 font-mono"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      aria-label="Browse folders on the selected server"
                      title="Browse server"
                      onClick={() => setBrowserOpen(true)}
                    >
                      <FolderOpen /> Browse
                    </InputGroupButton>
                  </InputGroupAddon>
                  {bridge &&
                    (localForm.getFieldValue('backendId') || backends.find((backend) => backend.isDefault)?.id) ===
                      backends.find((backend) => backend.isDefault)?.id && (
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          aria-label="Choose a local directory"
                          title="Choose folder"
                          disabled={choosingDirectory}
                          onClick={() => void chooseDirectory()}
                        >
                          {choosingDirectory ? <RefreshCw className="animate-spin" /> : <FolderOpen />}
                          Native
                        </InputGroupButton>
                      </InputGroupAddon>
                    )}
                </InputGroup>
              )}
            </localForm.Field>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-local-name">Name</FieldLabel>
            <localForm.Field name="name">
              {(field) => (
                <Input
                  id="settings-local-name"
                  placeholder="Optional"
                  className="h-9"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </localForm.Field>
          </Field>
          <Field>
            <FieldLabel>Workspace</FieldLabel>
            <localForm.Field name="strategy">
              {(field) => (
                <Select value={field.state.value} onValueChange={field.handleChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatic</SelectItem>
                    <SelectItem value="direct">Direct</SelectItem>
                    <SelectItem value="copy">Copy, then apply</SelectItem>
                    <SelectItem value="move">Move on apply</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </localForm.Field>
          </Field>
          <localForm.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button size="sm" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? <RefreshCw className="animate-spin" /> : <FolderPlus />}
                {isSubmitting ? 'Adding…' : 'Add directory'}
              </Button>
            )}
          </localForm.Subscribe>
          <p className="text-[11px] text-muted-foreground sm:col-span-full">
            Git directories use isolated worktrees by default. Plain directories work directly unless you choose an isolated copy.
          </p>
        </form>
        <CardContent className="border-t p-0">
          {repositories.map((repo, index) => (
            <div key={repo.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-b p-3 last:border-0">
              <div className="min-w-0">
                <strong className="block truncate font-mono text-xs">{repo.full_name}</strong>
                <span className="block truncate text-[11px] text-muted-foreground" title={repo.local_path}>
                  {repo.source_kind === 'directory'
                    ? `${repo.workspace_strategy === 'direct' ? 'Direct' : `${repo.workspace_strategy} workspace`} · ${repo.local_path}`
                    : repo.synced_at
                      ? `Synced ${age(repo.synced_at)}`
                      : repo.local_path}
                </span>
              </div>
              <div className="flex shrink-0 gap-1">
                {repo.source_kind === 'git' && (
                  <Button
                    data-audit-action={index === 0 ? 'settings.repository.environment' : undefined}
                    variant="outline"
                    size="icon-xs"
                    className="sm:w-auto sm:px-2"
                    aria-label={`Configure environment for ${repo.full_name}`}
                    title="Environment"
                    onClick={() => setEnvironmentRepo(repo)}
                  >
                    <FolderCog data-icon="inline-start" />
                    <span className="hidden sm:inline">Environment</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon-xs"
                  className="sm:w-auto sm:px-2"
                  aria-label={`Sync ${repo.full_name}`}
                  title="Sync"
                  onClick={() => sync(repo)}
                >
                  <RefreshCw data-icon="inline-start" />
                  <span className="hidden sm:inline">Sync</span>
                </Button>
              </div>
            </div>
          ))}
          {!repositories.length && (
            <Empty className="m-3 min-h-36 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderCog />
                </EmptyMedia>
                <EmptyTitle>No repositories yet</EmptyTitle>
                <EmptyDescription>Add a GitHub repository or local directory to enable Work-item workflows.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
      <RepositoryEnvironmentDialog
        repository={environmentRepo}
        onOpenChange={(open) => {
          if (!open) setEnvironmentRepo(null)
        }}
      />
      <ServerDirectoryBrowserDialog
        open={browserOpen}
        backendId={localForm.getFieldValue('backendId') || backends.find((backend) => backend.isDefault)?.id || ''}
        backendName={
          backends.find((backend) => backend.id === (localForm.getFieldValue('backendId') || backends.find((item) => item.isDefault)?.id))
            ?.label || 'Local'
        }
        initialPath={localForm.getFieldValue('path')}
        onOpenChange={setBrowserOpen}
        onSelect={(path) => localForm.setFieldValue('path', path)}
      />
    </>
  )
}

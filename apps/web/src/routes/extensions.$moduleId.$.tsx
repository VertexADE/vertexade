import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { ModuleCatalog, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { Blocks, Loader2, Settings } from 'lucide-react'
import { PortableExtensionHost } from '@vertexade/ui/components/portable-extension-host'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'
import { loadBackendRegistry, resolveBackend, type BackendDescriptor } from '@vertexade/ui/lib/backend-registry'

export const Route = createFileRoute('/extensions/$moduleId/$')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    server: typeof search.server === 'string' && search.server ? search.server.slice(0, 100) : undefined,
  }),
  component: ExtensionRoute,
})

function ExtensionRoute() {
  const { moduleId, _splat } = Route.useParams()
  const { server } = Route.useSearch()
  const navigate = Route.useNavigate()
  const catalog = useCatalogModule(moduleId, server)
  const detailId = extensionDetailId(_splat)

  return (
    <WorkspacePage>
      <ExtensionHeader
        module={catalog.module}
        moduleId={moduleId}
        backend={catalog.backend}
        backends={catalog.backends}
        onBackendChange={(backendId) =>
          void navigate({
            to: '/extensions/$moduleId/$',
            params: { moduleId, _splat: '' },
            search: (current) => ({ ...current, server: backendId }),
            replace: true,
            resetScroll: false,
          })
        }
      />
      <ModuleContent
        module={catalog.module}
        moduleId={moduleId}
        detailId={detailId}
        error={catalog.error}
        backendId={catalog.backend?.id}
        onDetailChange={(itemId) =>
          void navigate({
            to: '/extensions/$moduleId/$',
            params: { moduleId, _splat: itemId ? `items/${itemId}` : '' },
            search: (current) => current,
          })
        }
      />
    </WorkspacePage>
  )
}

function extensionDetailId(splat: string | undefined) {
  const match = splat?.match(/^items\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]!) : null
}

function ExtensionHeader({
  module,
  moduleId,
  backend,
  backends,
  onBackendChange,
}: {
  module: ModuleCatalogEntry | null | undefined
  moduleId: string
  backend: BackendDescriptor | null
  backends: BackendDescriptor[]
  onBackendChange(backendId: string): void
}) {
  return (
    <WorkspaceHeader
      eyebrow="Extension workspace"
      title={module?.name || moduleId}
      icon={Blocks}
      description={module?.description || 'Loading extension capabilities and connected data.'}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {backends.length > 1 && (
            <Select value={backend?.id || ''} onValueChange={onBackendChange}>
              <SelectTrigger size="sm" aria-label="Extension server">
                <SelectValue placeholder="Choose server" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  {backends.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          <ModuleVersion module={module} />
          <ModuleStatus module={module} />
        </div>
      }
    />
  )
}

function ModuleVersion({ module }: { module: ModuleCatalogEntry | null | undefined }) {
  if (!module) return null
  return (
    <Badge variant="outline" className="font-mono text-xs">
      v{module.version}
    </Badge>
  )
}

function ModuleStatus({ module }: { module: ModuleCatalogEntry | null | undefined }) {
  if (!module) return null
  return <Badge variant={module.enabled ? 'secondary' : 'outline'}>{module.enabled ? 'Enabled' : 'Disabled'}</Badge>
}

function useCatalogModule(moduleId: string, requestedBackendId?: string) {
  const [module, setModule] = useState<ModuleCatalogEntry | null | undefined>(undefined)
  const [backend, setBackend] = useState<BackendDescriptor | null>(null)
  const [backends, setBackends] = useState<BackendDescriptor[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setModule(undefined)
    setError('')
    void loadBackendRegistry()
      .then(async ({ backends: registered }) => {
        const catalogs = await Promise.allSettled(
          registered.map(async (candidate) => ({
            backend: candidate,
            catalog: await backendApi<ModuleCatalog>(candidate.id, '/api/modules'),
          })),
        )
        if (!active) return
        const available = catalogs.flatMap((result) => {
          if (result.status !== 'fulfilled') return []
          const matching = result.value.catalog.modules.find((item) => item.id === moduleId)
          return matching ? [{ backend: result.value.backend, module: matching }] : []
        })
        const selectedBackend = resolveBackend(
          available.map((entry) => entry.backend),
          requestedBackendId,
        )
        const selected = available.find((entry) => entry.backend.id === selectedBackend?.id)
        setBackends(available.map((entry) => entry.backend))
        setBackend(selectedBackend)
        setModule(selected?.module || null)
        if (!selected && catalogs.every((result) => result.status === 'rejected'))
          setError('No paired server could load its extension catalog')
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : 'Could not load the module catalog')
        setModule(null)
      })
    return () => {
      active = false
    }
  }, [moduleId, requestedBackendId])
  return { module, backend, backends, error }
}

function ModuleContent({
  module,
  moduleId,
  detailId,
  error,
  backendId,
  onDetailChange,
}: {
  module: ModuleCatalogEntry | null | undefined
  moduleId: string
  detailId: string | null
  error: string
  backendId?: string
  onDetailChange(itemId: string | null): void
}) {
  if (module === undefined) return <ExtensionLoading />
  if (!module) return <UnavailableExtension message={error || `No installed module is registered as ${moduleId}.`} />
  if (!module.enabled) return <UnavailableExtension message={`${module.name} is installed but disabled.`} />
  if (module.portable?.surfaces.length)
    return <PortableExtensionHost module={module} detailId={detailId} backendId={backendId} onDetailChange={onDetailChange} />
  return <UnavailableExtension message={`${module.name} does not provide a portable surface.`} />
}

function UnavailableExtension({ message }: { message: string }) {
  return (
    <Empty className="min-h-56">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Blocks />
        </EmptyMedia>
        <EmptyTitle>Extension unavailable</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" asChild>
          <a href="/extensions">
            <Settings />
            Manage extensions
          </a>
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function ExtensionLoading() {
  return (
    <Empty className="min-h-56" aria-live="polite">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Loader2 className="animate-spin" />
        </EmptyMedia>
        <EmptyTitle>Loading extension</EmptyTitle>
        <EmptyDescription>Reading the installed module catalog and portable surface.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

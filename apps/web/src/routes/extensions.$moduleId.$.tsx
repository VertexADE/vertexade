import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { ModuleCatalog, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { Blocks, Loader2, Settings } from 'lucide-react'
import { PortableExtensionHost } from '@vertexade/ui/components/portable-extension-host'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { api } from '@vertexade/ui/lib/dashboard-api'

export const Route = createFileRoute('/extensions/$moduleId/$')({
  ssr: false,
  component: ExtensionRoute,
})

function ExtensionRoute() {
  const { moduleId, _splat } = Route.useParams()
  const navigate = Route.useNavigate()
  const { module, error } = useCatalogModule(moduleId)
  const detailId = extensionDetailId(_splat)

  return (
    <WorkspacePage>
      {!detailId && <ExtensionHeader module={module} moduleId={moduleId} />}
      <ModuleContent
        module={module}
        moduleId={moduleId}
        detailId={detailId}
        error={error}
        onDetailChange={(itemId) =>
          void navigate({
            to: '/extensions/$moduleId/$',
            params: { moduleId, _splat: itemId ? `items/${itemId}` : '' },
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

function ExtensionHeader({ module, moduleId }: { module: ModuleCatalogEntry | null | undefined; moduleId: string }) {
  return (
    <WorkspaceHeader
      eyebrow="Extension workspace"
      title={module?.name || moduleId}
      icon={Blocks}
      description={module?.description || 'Loading extension capabilities and connected data.'}
      actions={
        <div className="flex flex-wrap items-center gap-2">
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

function useCatalogModule(moduleId: string) {
  const [module, setModule] = useState<ModuleCatalogEntry | null | undefined>(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void api<ModuleCatalog>('/api/modules')
      .then((catalog) => {
        if (active) setModule(catalog.modules.find((item) => item.id === moduleId) || null)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : 'Could not load the module catalog')
        setModule(null)
      })
    return () => {
      active = false
    }
  }, [moduleId])
  return { module, error }
}

function ModuleContent({
  module,
  moduleId,
  detailId,
  error,
  onDetailChange,
}: {
  module: ModuleCatalogEntry | null | undefined
  moduleId: string
  detailId: string | null
  error: string
  onDetailChange(itemId: string | null): void
}) {
  if (module === undefined) return <ExtensionLoading />
  if (!module) return <UnavailableExtension message={error || `No installed module is registered as ${moduleId}.`} />
  if (!module.enabled) return <UnavailableExtension message={`${module.name} is installed but disabled.`} />
  if (module.portable?.surfaces.length) return <PortableExtensionHost module={module} detailId={detailId} onDetailChange={onDetailChange} />
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

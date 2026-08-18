import type { ExtensionCacheStats, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { AlertTriangle, Check, ExternalLink, Pin, RefreshCw, ShieldCheck } from 'lucide-react'
import { ExtensionSettingsPanel } from '@vertexade/ui/extensions/settings-panel'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { SheetDescription, SheetHeader, SheetTitle } from '@vertexade/ui/components/ui/sheet'
import { cn } from '@vertexade/ui/lib/utils'
import type { BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import { categoryLabel, LifecycleBadge } from './extension-catalog-shared'
import { extensionEnableAction } from './extension-card'

export function ExtensionDetailsHeader({
  module,
  workspaceRoute,
  pinned,
  onTogglePin,
  icon: Icon,
  iconClass,
  backend,
}: {
  module: ModuleCatalogEntry
  workspaceRoute?: string | null
  pinned: boolean
  onTogglePin(): void
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  backend?: Pick<BackendDescriptor, 'label' | 'connected'>
}) {
  return (
    <SheetHeader className="border-b p-4 pr-12 sm:p-6 sm:pr-14">
      <div className="flex items-start gap-3">
        <div className={cn('grid size-11 shrink-0 place-items-center rounded-xl', iconClass)}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <SheetTitle className="text-lg">{module.name}</SheetTitle>
          <SheetDescription>{module.catalog?.tagline || module.description}</SheetDescription>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <LifecycleBadge module={module} />
        <Badge variant="outline">v{module.version}</Badge>
        <Badge variant="outline">Platform API {module.platformApi}</Badge>
        {backend ? (
          <Badge variant="outline">
            <span className={cn('size-1.5 rounded-full', backend.connected ? 'bg-success' : 'bg-warning')} />
            {backend.label} · {backend.connected ? 'Connected' : 'Offline'}
          </Badge>
        ) : null}
        {module.enabled && workspaceRoute && (
          <Button variant="outline" size="xs" onClick={onTogglePin}>
            <Pin className={cn(pinned && 'fill-current text-primary')} />
            {pinned ? 'Pinned' : 'Pin to sidebar'}
          </Button>
        )}
      </div>
    </SheetHeader>
  )
}

export function ExtensionStatusMessage({ module }: { module: ModuleCatalogEntry }) {
  if (!module.failure?.message && !module.message) return null
  return (
    <div
      className={cn(
        'flex gap-2 rounded-lg border p-3 text-xs',
        module.failure ? 'border-rose-500/30 bg-rose-500/5 text-rose-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-300',
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        {module.failure && <p className="mb-1 font-mono text-xs uppercase tracking-wide">Failed during {module.failure.phase}</p>}
        {module.failure?.message || module.message}
      </div>
    </div>
  )
}

export function ExtensionHighlights({ module }: { module: ModuleCatalogEntry }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What it adds</h3>
      <ul className="mt-3 space-y-2">
        {(module.catalog?.highlights || []).map((item) => (
          <li key={item} className="flex gap-2 text-sm">
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <Check className="size-2.5" />
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ExtensionFacts({ module }: { module: ModuleCatalogEntry }) {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-2">
      <DetailFact label="Publisher" value={module.catalog?.publisher.name || 'Unknown'} />
      <DetailFact label="Category" value={categoryLabel(module.catalog?.category || 'other')} />
      <DetailFact label="Origin" value={module.installation.origin === 'bundled' ? 'Bundled with VertexADE' : 'Local extension'} />
      <DetailFact label="Permissions" value={`${module.permissions?.length || 0} declared`} />
      <DetailFact
        label="Platform features"
        value={module.requires?.platformFeatures?.length ? `${module.requires.platformFeatures.length} required` : 'API only'}
      />
      <DetailFact
        label="Entrypoint checksum"
        value={module.installation.checksum ? module.installation.checksum.slice(0, 12) : 'Unavailable'}
        mono
      />
    </section>
  )
}

export function ExtensionCacheSection({ cache, busy, onClear }: { cache?: ExtensionCacheStats; busy: boolean; onClear(): void }) {
  if (!cache) return null
  return (
    <section className="rounded-lg border bg-muted/10 p-3">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold">Extension cache</h3>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {cache.entries} entries · {cache.hits + cache.staleHits} hits · {cache.refreshes} upstream refreshes
            {cache.lastRefreshAt ? ` · last ${new Date(cache.lastRefreshAt).toLocaleString()}` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" disabled={busy || !cache.entries} onClick={onClear}>
          <RefreshCw />
          Clear cache
        </Button>
      </div>
    </section>
  )
}

export function ExtensionLinks({ module, workspaceRoute }: { module: ModuleCatalogEntry; workspaceRoute?: string | null }) {
  const links = module.catalog?.links
  if (!workspaceRoute && !links?.homepage && !links?.documentation) return null
  return (
    <div className="flex flex-wrap gap-2">
      {module.enabled && workspaceRoute && (
        <Button asChild size="sm">
          <a href={workspaceRoute}>Open workspace</a>
        </Button>
      )}
      {links?.homepage && (
        <Button asChild variant="outline" size="sm">
          <a href={links.homepage} target="_blank" rel="noreferrer">
            <ExternalLink />
            Website
          </a>
        </Button>
      )}
    </div>
  )
}

export function ExtensionConfiguration({
  module,
  busy,
  onToggle,
  onChanged,
  backendId,
}: {
  module: ModuleCatalogEntry
  busy: boolean
  onToggle(enabled: boolean): void
  onChanged(): void
  backendId?: string
}) {
  const enableAction = extensionEnableAction(module, busy)
  return (
    <div className="border-t pt-5">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">{module.portable?.settings?.title || 'Extension settings'}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {module.portable?.settings?.description || 'Configure this extension for the workspace.'}
          </p>
        </div>
        {module.enabled ? (
          <Button variant="outline" size="sm" className="shrink-0" disabled={busy} onClick={() => onToggle(false)}>
            Disable extension
          </Button>
        ) : (
          <Button size="sm" className="w-full shrink-0 sm:w-auto" disabled={enableAction.disabled} onClick={() => onToggle(true)}>
            {enableAction.label} extension
          </Button>
        )}
      </div>
      <ExtensionSettingsPanel module={module} backendId={backendId} onChanged={onChanged} />
    </div>
  )
}

export function ExtensionPermissions({ module }: { module: ModuleCatalogEntry }) {
  return (
    <div className="rounded-lg border bg-muted/15 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <ShieldCheck className="size-3.5 text-emerald-400" />
        Declared access
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(module.permissions || []).map((permission) => (
          <Badge key={permission} variant="outline" className="font-mono text-xs font-normal">
            {permission}
          </Badge>
        ))}
        {!module.permissions?.length && <span className="text-xs text-muted-foreground">No host permissions requested.</span>}
      </div>
    </div>
  )
}

function DetailFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/10 p-3">
      <span className="block text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <strong className={cn('mt-1 block break-words font-medium', mono && 'break-all font-mono text-xs')} title={value}>
        {value}
      </strong>
    </div>
  )
}

import type { ExtensionCacheStats, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { MoreHorizontal, Pin, RefreshCw, Settings2 } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@vertexade/ui/components/ui/dropdown-menu'
import { extensionPresentation } from '@vertexade/ui/lib/extension-presentation'
import { extensionWorkspaceRoute } from '@vertexade/ui/lib/extension-workspace'
import { cn } from '@vertexade/ui/lib/utils'
import type { BackendDescriptor } from '@vertexade/ui/lib/backend-registry'

import { LifecycleBadge } from './extension-catalog-shared'
import { ExtensionPrimaryAction, extensionCardMeta } from './extension-card'
export function ExtensionInstalledRow({
  module,
  cache,
  busy,
  pinned,
  onManage,
  onTogglePin,
  onToggle,
  onClearCache,
  backend,
}: {
  module: ModuleCatalogEntry
  cache?: ExtensionCacheStats
  busy: boolean
  pinned: boolean
  onManage(): void
  onTogglePin(): void
  onToggle(enabled: boolean): void
  onClearCache(): void
  backend?: Pick<BackendDescriptor, 'id' | 'label' | 'connected'>
}) {
  const { accent, Icon } = extensionPresentation(module, backend?.id)
  return (
    <article className="grid min-w-0 gap-2 border-b p-2.5 last:border-b-0 hover:bg-accent/20 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset ring-white/5', accent.icon)}>
          <Icon className="size-4" />
        </span>
        <ExtensionInstalledSummary module={module} cache={cache} pinned={pinned} backend={backend} />
      </div>
      <ExtensionInstalledActions
        module={module}
        cache={cache}
        busy={busy}
        pinned={pinned}
        onManage={onManage}
        onTogglePin={onTogglePin}
        onToggle={onToggle}
        onClearCache={onClearCache}
        backendId={backend?.id}
      />
    </article>
  )
}

function ExtensionInstalledSummary({
  module,
  cache,
  pinned,
  backend,
}: {
  module: ModuleCatalogEntry
  cache?: ExtensionCacheStats
  pinned: boolean
  backend?: Pick<BackendDescriptor, 'label' | 'connected'>
}) {
  const summary = extensionCardMeta(module, cache) || 'No provider metadata'
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="truncate text-sm font-semibold">{module.name}</h2>
        <LifecycleBadge module={module} />
        <PinnedBadge pinned={pinned} />
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{extensionDescription(module)}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        {backend ? (
          <span className="inline-flex items-center gap-1">
            <span className={cn('size-1.5 rounded-full', backend.connected ? 'bg-success' : 'bg-warning')} />
            {backend.label} · {backend.connected ? 'Connected' : 'Offline'}
          </span>
        ) : null}
        <span>v{module.version}</span>
        <span>{summary}</span>
      </p>
    </div>
  )
}

function PinnedBadge({ pinned }: { pinned: boolean }) {
  if (!pinned) return null
  return <Badge variant="secondary">Pinned</Badge>
}

function extensionDescription(module: ModuleCatalogEntry) {
  return module.catalog?.tagline || module.description
}

function extensionPinLabel(module: ModuleCatalogEntry, pinned: boolean) {
  return pinned ? `Unpin ${module.name}` : `Pin ${module.name}`
}

function extensionCacheDisabled(cache: ExtensionCacheStats | undefined, busy: boolean) {
  return busy || !cache?.entries
}

function pinnedIconClass(pinned: boolean) {
  return pinned ? 'fill-current text-primary' : undefined
}

function ExtensionInstalledActions({
  module,
  cache,
  busy,
  pinned,
  onManage,
  onTogglePin,
  onToggle,
  onClearCache,
  backendId,
}: {
  module: ModuleCatalogEntry
  cache?: ExtensionCacheStats
  busy: boolean
  pinned: boolean
  onManage(): void
  onTogglePin(): void
  onToggle(enabled: boolean): void
  onClearCache(): void
  backendId?: string
}) {
  const pinLabel = extensionPinLabel(module, pinned)
  const cacheDisabled = extensionCacheDisabled(cache, busy)
  const workspaceRoute = extensionWorkspaceRoute(module, backendId)
  const primaryAction =
    workspaceRoute || !module.enabled ? (
      <ExtensionPrimaryAction module={module} busy={busy} onToggle={onToggle} backendId={backendId} />
    ) : (
      <Button variant="outline" size="sm" onClick={onManage}>
        <Settings2 />
        Configure
      </Button>
    )
  const moreMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={`More actions for ${module.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem disabled={!workspaceRoute} onSelect={onTogglePin}>
          <Pin className={pinnedIconClass(pinned)} />
          {pinLabel}
        </DropdownMenuItem>
        {(workspaceRoute || !module.enabled) && (
          <DropdownMenuItem onSelect={onManage}>
            <Settings2 />
            Configure
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={cacheDisabled} onSelect={onClearCache}>
          <RefreshCw />
          Clear cache
        </DropdownMenuItem>
        {module.enabled && (
          <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => onToggle(false)}>
            Disable
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  return (
    <div className="flex justify-end gap-1.5">
      {primaryAction}
      {moreMenu}
    </div>
  )
}

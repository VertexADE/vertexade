import type { ExtensionCacheStats, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { ArrowRight, PackageCheck, Pin, Settings2 } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { extensionPresentation } from '@vertexade/ui/lib/extension-presentation'
import { extensionWorkspaceRoute } from '@vertexade/ui/lib/extension-workspace'
import { cn } from '@vertexade/ui/lib/utils'

import { LifecycleBadge } from './extension-catalog-shared'
export function ExtensionCard({
  module,
  cache,
  busy,
  pinned,
  onManage,
  onTogglePin,
  onToggle,
}: {
  module: ModuleCatalogEntry
  cache?: ExtensionCacheStats
  busy: boolean
  pinned: boolean
  onManage(): void
  onTogglePin(): void
  onToggle(enabled: boolean): void
}) {
  const { accent, Icon } = extensionPresentation(module)
  return (
    <Card className={cn('gap-0 overflow-hidden py-0', accent.panel)}>
      <CardHeader className="gap-2 p-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className={cn('grid size-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset ring-white/5', accent.icon)}>
            <Icon className="size-4" />
          </div>
          <ExtensionCardStatus module={module} pinned={pinned} onTogglePin={onTogglePin} />
        </div>
        <div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <CardTitle className="text-base">{module.name}</CardTitle>
            <span className="text-xs text-muted-foreground">v{module.version}</span>
          </div>
          <CardDescription className="mt-0.5 line-clamp-2 min-h-8 text-xs leading-snug">
            {module.catalog?.tagline || module.description}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-28 flex-col px-3 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {(module.catalog?.tags || []).slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="font-normal">
              {tag}
            </Badge>
          ))}
        </div>
        <div className="mt-auto pt-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <ExtensionInstallLabel module={module} />
            <span className="truncate">{extensionCardMeta(module, cache)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={onManage}>
              <Settings2 />
              Configure
            </Button>
            <ExtensionPrimaryAction module={module} busy={busy} onToggle={onToggle} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ExtensionCardStatus({ module, pinned, onTogglePin }: { module: ModuleCatalogEntry; pinned: boolean; onTogglePin(): void }) {
  const enabledLabel = pinned ? 'Enabled · pinned' : 'Enabled'
  const status = module.pending ? 'Retry needed' : module.enabled ? enabledLabel : 'Disabled'
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <ExtensionPinButton module={module} pinned={pinned} onTogglePin={onTogglePin} />
        <LifecycleBadge module={module} />
      </div>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <ExtensionEnabledDot enabled={module.enabled} />
        {status}
      </span>
    </div>
  )
}

function ExtensionPinButton({ module, pinned, onTogglePin }: { module: ModuleCatalogEntry; pinned: boolean; onTogglePin(): void }) {
  const label = pinned ? `Unpin ${module.name}` : `Pin ${module.name} to sidebar`
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      disabled={!module.enabled || !extensionWorkspaceRoute(module)}
      onClick={onTogglePin}
      aria-label={label}
    >
      <Pin className={cn(pinned && 'fill-current text-primary')} />
    </Button>
  )
}

function ExtensionEnabledDot({ enabled }: { enabled: boolean }) {
  return <span className={cn('size-1.5 rounded-full', enabled ? 'bg-blue-400' : 'bg-muted-foreground')} />
}

function ExtensionInstallLabel({ module }: { module: ModuleCatalogEntry }) {
  const label = module.installation.origin === 'bundled' ? 'Bundled · installed' : 'Local · installed'
  return (
    <span className="flex items-center gap-1">
      <PackageCheck className="size-3.5" />
      {label}
    </span>
  )
}

export function extensionCardMeta(module: ModuleCatalogEntry, cache?: ExtensionCacheStats) {
  if (cache?.entries) return `${cache.entries} cached · ${cache.hits + cache.staleHits} hits`
  const { providers = [], agents = [] } = module
  return [...providers, ...agents].map((provider) => provider.name).join(', ')
}

export function ExtensionPrimaryAction({
  module,
  busy,
  onToggle,
}: {
  module: ModuleCatalogEntry
  busy: boolean
  onToggle(enabled: boolean): void
}) {
  const workspaceRoute = extensionWorkspaceRoute(module)
  if (module.pending) {
    const desired = module.desiredEnabled ?? !module.enabled
    return (
      <Button variant="secondary" size="sm" disabled={busy} title={module.stateError} onClick={() => onToggle(desired)}>
        {busy ? 'Applying…' : `Retry ${desired ? 'enable' : 'disable'}`}
      </Button>
    )
  }
  if (workspaceRoute && module.enabled)
    return (
      <Button asChild size="sm">
        <a href={workspaceRoute}>
          Open <ArrowRight />
        </a>
      </Button>
    )
  if (module.enabled)
    return (
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => onToggle(false)}>
        Disable
      </Button>
    )
  const enableAction = extensionEnableAction(module, busy)
  return (
    <Button size="sm" disabled={enableAction.disabled} onClick={() => onToggle(true)}>
      {enableAction.label}
    </Button>
  )
}

export function extensionEnableAction(module: ModuleCatalogEntry, busy: boolean) {
  return {
    disabled: busy,
    label: module.lifecycle === 'failed' ? 'Retry enable' : 'Enable',
  }
}

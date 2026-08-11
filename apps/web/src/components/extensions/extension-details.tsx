import type { ExtensionCacheStats, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { SheetContent } from '@vertexade/ui/components/ui/sheet'
import { extensionPresentation } from '@vertexade/ui/lib/extension-presentation'
import { extensionWorkspaceRoute } from '@vertexade/ui/lib/extension-workspace'
import { cn } from '@vertexade/ui/lib/utils'
import {
  ExtensionCacheSection,
  ExtensionConfiguration,
  ExtensionDetailsHeader,
  ExtensionFacts,
  ExtensionHighlights,
  ExtensionLinks,
  ExtensionPermissions,
  ExtensionStatusMessage,
} from './extension-detail-sections'

export function ExtensionDetails({
  module,
  cache,
  busy,
  pinned,
  onTogglePin,
  onToggle,
  onClearCache,
  onChanged,
}: {
  module: ModuleCatalogEntry
  cache?: ExtensionCacheStats
  busy: boolean
  pinned: boolean
  onTogglePin(): void
  onToggle(enabled: boolean): void
  onClearCache(): void
  onChanged(): void
}) {
  const { accent, Icon } = extensionPresentation(module)
  const workspaceRoute = extensionWorkspaceRoute(module)
  const settingsWidth = module.portable?.settings ? 'sm:!max-w-3xl xl:!max-w-4xl' : 'sm:!max-w-xl'
  return (
    <SheetContent side="right" className={cn('!w-full max-w-none gap-0', settingsWidth)}>
      <ExtensionDetailsHeader
        module={module}
        workspaceRoute={workspaceRoute}
        pinned={pinned}
        onTogglePin={onTogglePin}
        icon={Icon}
        iconClass={accent.icon}
      />
      <div className="min-w-0 space-y-5 p-4 sm:p-6">
        <ExtensionStatusMessage module={module} />
        <ExtensionHighlights module={module} />
        <ExtensionFacts module={module} />
        <ExtensionCacheSection cache={cache} busy={busy} onClear={onClearCache} />
        <ExtensionLinks module={module} workspaceRoute={workspaceRoute} />
        <ExtensionConfiguration module={module} busy={busy} onToggle={onToggle} onChanged={onChanged} />
        <ExtensionPermissions module={module} />
      </div>
    </SheetContent>
  )
}

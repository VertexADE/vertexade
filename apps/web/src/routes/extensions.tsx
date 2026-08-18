import { useMemo, useState } from 'react'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import type { ExtensionCacheStats, ModuleCatalog, ModuleCatalogCategory, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { AlertTriangle, Boxes, CircleDot, PackageOpen, PlugZap, Server, SlidersHorizontal, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { AgentResourceSettings } from '@vertexade/ui/components/agent-resource-settings'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { SearchInput } from '@vertexade/ui/components/ui/search-input'
import { Sheet } from '@vertexade/ui/components/ui/sheet'
import { StatusPanel, StatusPanelContent, StatusPanelDescription, StatusPanelTitle } from '@vertexade/ui/components/ui/status'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertexade/ui/components/ui/tabs'
import { FilterBar, FilterBarControls, FilterBarToggle, FilterChip, ToolbarGroup, ToolbarLabel } from '@vertexade/ui/components/ui/toolbar'
import { useReactiveApi } from '@vertexade/ui/hooks/use-reactive-api'
import { backendApi, isModuleCatalogEvent } from '@vertexade/ui/lib/dashboard-api'
import { loadBackendRegistry, resolveBackend, type BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import { cn } from '@vertexade/ui/lib/utils'
import { useUiPreferences } from '@vertexade/ui/lib/ui-preferences'
import { extensionAvailableInView, extensionBackendConnection, type ExtensionCatalogView } from '../lib/extension-catalog'
import {
  categoryLabel,
  ExtensionCard,
  ExtensionDetails,
  ExtensionInstalledRow,
} from '../components/extensions/extension-catalog-components'

export const Route = createFileRoute('/extensions')({ ssr: false, component: Outlet })

type LifecycleFilter = 'all' | 'ready' | 'attention' | 'disabled'
type BackendCatalog = { backend: BackendDescriptor; catalog: ModuleCatalog | null; error: string }
type UnifiedExtensionCatalog = { catalogs: BackendCatalog[] }
type ExtensionEntry = { key: string; backend: BackendDescriptor; module: ModuleCatalogEntry; cache?: ExtensionCacheStats }

function matchesLifecycle(module: ModuleCatalogEntry, filter: LifecycleFilter) {
  if (filter === 'all') return true
  if (filter === 'attention') return ['setup-required', 'degraded', 'failed'].includes(module.lifecycle)
  return module.lifecycle === filter
}

async function loadUnifiedExtensionCatalog(): Promise<UnifiedExtensionCatalog> {
  const { backends } = await loadBackendRegistry()
  const catalogs = await Promise.all(
    backends.map(async (backend): Promise<BackendCatalog> => {
      try {
        const catalog = await backendApi<ModuleCatalog>(backend.id, '/api/modules')
        return { backend: extensionBackendConnection(backend, null), catalog, error: '' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { backend: extensionBackendConnection(backend, message), catalog: null, error: message }
      }
    }),
  )
  return { catalogs }
}

export function ExtensionsPage() {
  const catalog = useReactiveApi<UnifiedExtensionCatalog>({
    key: 'unified-module-catalog',
    load: loadUnifiedExtensionCatalog,
    accepts: isModuleCatalogEvent,
  })
  const catalogs = catalog.data ? catalog.data.catalogs : []
  const [resourceServerId, setResourceServerId] = useState('')
  const summary = extensionSummary(catalogs)
  const resourceBackend = selectedResourceBackend(catalogs, resourceServerId)

  function selectResourceBackend(backend: BackendDescriptor) {
    setResourceServerId(backend.id)
  }

  return (
    <WorkspacePage>
      <WorkspaceHeader eyebrow="Tools and integrations" title="Extensions" description={extensionsDescription(summary, catalogs.length)} />
      <ExtensionTabs catalog={catalog} catalogs={catalogs} resourceBackend={resourceBackend} onSelectResource={selectResourceBackend} />
    </WorkspacePage>
  )
}

function selectedResourceBackend(catalogs: BackendCatalog[], requested: string) {
  const selected = catalogs.find(({ backend }) => backend.id === requested)
  return selected ? selected.backend : resolveBackend(catalogs.map(({ backend }) => backend))
}

function extensionsDescription(summary: ReturnType<typeof extensionSummary>, serverCount: number) {
  const servers = Math.max(serverCount, 1)
  const attention = summary.attention ? ` · ${summary.attention} need setup` : ''
  return `${summary.active} active tools across ${servers} ${servers === 1 ? 'server' : 'servers'}${attention}.`
}

function ExtensionTabs({
  catalog,
  catalogs,
  resourceBackend,
  onSelectResource,
}: {
  catalog: CatalogController
  catalogs: BackendCatalog[]
  resourceBackend: BackendDescriptor | null
  onSelectResource(backend: BackendDescriptor): void
}) {
  const resourceKey = resourceBackend ? resourceBackend.id : 'default'
  return (
    <Tabs defaultValue="apps" className="gap-4">
      <TabsList aria-label="Extension type" className="w-full justify-start overflow-x-auto sm:w-fit">
        <TabsTrigger value="apps">
          <Boxes /> App extensions
        </TabsTrigger>
        <TabsTrigger value="skills">
          <Sparkles /> Skills
        </TabsTrigger>
        <TabsTrigger value="mcp">
          <PlugZap /> MCP servers
        </TabsTrigger>
        <TabsTrigger value="plugins">
          <PackageOpen /> Agent Plugins
        </TabsTrigger>
      </TabsList>
      <TabsContent value="skills">
        <section aria-label="Skills" className="space-y-3">
          <ResourceServerScope catalogs={catalogs} selected={resourceBackend} onSelect={onSelectResource} />
          <AgentResourceSettings key={`skills:${resourceKey}`} section="skills" backendId={resourceBackend?.id} />
        </section>
      </TabsContent>
      <TabsContent value="mcp">
        <section aria-label="MCP servers" className="space-y-3">
          <ResourceServerScope catalogs={catalogs} selected={resourceBackend} onSelect={onSelectResource} />
          <AgentResourceSettings key={`mcp:${resourceKey}`} section="mcp" backendId={resourceBackend?.id} />
        </section>
      </TabsContent>
      <TabsContent value="plugins">
        <section aria-label="Agent Plugins" className="space-y-3">
          <ResourceServerScope catalogs={catalogs} selected={resourceBackend} onSelect={onSelectResource} />
          <AgentResourceSettings key={`plugins:${resourceKey}`} section="plugins" backendId={resourceBackend?.id} />
        </section>
      </TabsContent>
      <TabsContent value="apps">
        <AppExtensionsTab catalog={catalog} catalogs={catalogs} />
      </TabsContent>
    </Tabs>
  )
}

type CatalogController = {
  loading: boolean
  ready: boolean
  refresh(): Promise<UnifiedExtensionCatalog | undefined>
}

type ExtensionFilters = {
  query: string
  category: ModuleCatalogCategory | 'all'
  lifecycle: LifecycleFilter
  serverId: string
  view: ExtensionCatalogView
}

function catalogEntries(catalogs: BackendCatalog[]): ExtensionEntry[] {
  return catalogs.flatMap(({ backend, catalog }) =>
    (catalog?.modules || []).map((module) => ({
      key: `${backend.id}:${module.id}`,
      backend,
      module,
      cache: (catalog?.cache || []).find((item) => item.namespace === module.id),
    })),
  )
}

function extensionSummary(catalogs: BackendCatalog[]) {
  const modules = catalogEntries(catalogs).map((entry) => entry.module)
  return {
    active: modules.filter((module) => module.enabled).length,
    attention: modules.filter((module) => ['setup-required', 'degraded', 'failed'].includes(module.lifecycle)).length,
  }
}

function filterEntries(entries: ExtensionEntry[], filters: ExtensionFilters) {
  const needle = filters.query.trim().toLowerCase()
  return entries
    .filter((entry) => filters.serverId === 'all' || entry.backend.id === filters.serverId)
    .filter(({ module }) => extensionAvailableInView(module, filters.view))
    .filter(({ module }) => filters.category === 'all' || (module.catalog?.category || 'other') === filters.category)
    .filter(({ module }) => matchesLifecycle(module, filters.lifecycle))
    .filter(({ module, backend }) => matchesExtensionQuery(module, backend, needle))
    .sort(compareExtensions)
}

function matchesExtensionQuery(module: ModuleCatalogEntry, backend: BackendDescriptor, needle: string) {
  if (!needle) return true
  return [module.name, module.description, module.catalog?.tagline, backend.label, ...(module.catalog?.tags || [])].some((value) =>
    value?.toLowerCase().includes(needle),
  )
}

function compareExtensions(a: ExtensionEntry, b: ExtensionEntry) {
  return (
    Number(Boolean(b.module.catalog?.featured)) - Number(Boolean(a.module.catalog?.featured)) ||
    a.module.name.localeCompare(b.module.name) ||
    a.backend.label.localeCompare(b.backend.label)
  )
}

function AppExtensionsTab({ catalog, catalogs }: { catalog: CatalogController; catalogs: BackendCatalog[] }) {
  const state = useAppExtensions(catalog, catalogs)
  return (
    <section aria-label="Browse app extensions" className="flex flex-col gap-3">
      <ExtensionProblems catalogs={catalogs} />
      <ExtensionFilterControls catalogs={catalogs} state={state} />
      <ExtensionResults state={state} />
      <ExtensionDetailSheet state={state} onChanged={catalog.refresh} />
    </section>
  )
}

function useAppExtensions(catalog: CatalogController, catalogs: BackendCatalog[]) {
  const entries = useMemo(() => catalogEntries(catalogs), [catalogs])
  const modules = entries.map((entry) => entry.module)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ModuleCatalogCategory | 'all'>('all')
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>('all')
  const [serverId, setServerId] = useState('all')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [view, setView] = useState<ExtensionCatalogView>('installed')
  const preferences = useUiPreferences()
  const pinned = useMemo(() => new Set(preferences.value.extensionPins), [preferences.value.extensionPins])
  const categories = useMemo(() => [...new Set(modules.map((module) => module.catalog?.category || 'other'))], [modules])
  const filters = { query, category, lifecycle, serverId, view }
  const visible = useMemo(() => filterEntries(entries, filters), [category, entries, lifecycle, query, serverId, view])
  const selected = entries.find((entry) => entry.key === selectedId) || null

  async function toggle(entry: ExtensionEntry, enabled: boolean) {
    setBusy(entry.key)
    try {
      await setExtensionEnabled(entry, enabled)
      toast.success(`${entry.module.name} ${enabled ? 'enabled' : 'disabled'}`)
      await catalog.refresh()
      if (enabled) setSelectedId(entry.key)
    } catch (error) {
      toast.error((error as Error).message)
      await catalog.refresh()
    } finally {
      setBusy('')
    }
  }

  async function clearCache(entry: ExtensionEntry) {
    setBusy(`cache:${entry.key}`)
    try {
      const removed = await clearExtensionCache(entry)
      toast.success(cacheClearedMessage(entry.module, removed))
      await catalog.refresh()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  function togglePin(module: ModuleCatalogEntry) {
    const next = new Set(pinned)
    if (next.has(module.id)) next.delete(module.id)
    else next.add(module.id)
    void preferences.update({ extensionPins: [...next] }).catch((error) => toast.error((error as Error).message))
    toast.success(next.has(module.id) ? `${module.name} pinned to the sidebar` : `${module.name} removed from the sidebar`)
  }

  return {
    active: modules.filter((module) => module.enabled).length,
    activeFilters: Number(view !== 'installed') + Number(category !== 'all') + Number(lifecycle !== 'all') + Number(serverId !== 'all'),
    attention: modules.filter((module) => ['setup-required', 'degraded', 'failed'].includes(module.lifecycle)).length,
    busy,
    categories,
    category,
    clearCache,
    disabled: modules.filter((module) => module.lifecycle === 'disabled').length,
    lifecycle,
    loading: catalog.loading && !catalog.ready,
    mobileFiltersOpen,
    modules,
    pinned,
    query,
    ready: modules.filter((module) => module.lifecycle === 'ready').length,
    selected,
    serverId,
    setCategory,
    setLifecycle,
    setMobileFiltersOpen,
    setQuery,
    setSelectedId,
    setServerId,
    setView,
    toggle,
    togglePin,
    view,
    visible,
  }
}

async function setExtensionEnabled(entry: ExtensionEntry, enabled: boolean) {
  await backendApi(entry.backend.id, '/api/settings/extensions', {
    method: 'PATCH',
    body: JSON.stringify({ id: entry.module.id, enabled }),
  })
}

async function clearExtensionCache(entry: ExtensionEntry) {
  const result = await backendApi<{ removed: number }>(entry.backend.id, `/api/modules/${encodeURIComponent(entry.module.id)}/cache`, {
    method: 'DELETE',
  })
  return result.removed
}

function cacheClearedMessage(module: ModuleCatalogEntry, removed: number) {
  return removed ? `Cleared ${removed} cached ${removed === 1 ? 'response' : 'responses'}` : `${module.name} cache is already clear`
}

type AppExtensionState = ReturnType<typeof useAppExtensions>

function ExtensionProblems({ catalogs }: { catalogs: BackendCatalog[] }) {
  const diagnostics = catalogs.flatMap(({ backend, catalog }) =>
    (catalog?.diagnostics || []).map((diagnostic) => ({ backend, diagnostic })),
  )
  const connectionErrors = catalogs.filter((entry) => entry.error)
  const total = diagnostics.length + connectionErrors.length
  if (!total) return null
  return (
    <StatusPanel tone="danger">
      <AlertTriangle />
      <StatusPanelContent>
        <StatusPanelTitle>
          {total} extension {total === 1 ? 'problem was' : 'problems were'} isolated
        </StatusPanelTitle>
        <StatusPanelDescription>Other extensions remain available.</StatusPanelDescription>
        <ul className="mt-2 space-y-1 font-mono text-[10px]">
          {connectionErrors.map(({ backend, error }) => (
            <li key={backend.id} className="break-words">
              <span className="font-semibold">{backend.label} · connection</span> — {error}
            </li>
          ))}
          {diagnostics.slice(0, Math.max(0, 3 - connectionErrors.length)).map(({ backend, diagnostic }, index) => (
            <li key={`${backend.id}:${diagnostic.moduleId}:${diagnostic.phase}:${index}`} className="break-words">
              <span className="font-semibold">
                {backend.label} · {diagnostic.moduleId} · {diagnostic.phase}
              </span>{' '}
              — {diagnostic.message}
            </li>
          ))}
        </ul>
      </StatusPanelContent>
    </StatusPanel>
  )
}

function ExtensionFilterControls({ catalogs, state }: { catalogs: BackendCatalog[]; state: AppExtensionState }) {
  return (
    <FilterBar className="sm:flex-col sm:items-stretch">
      <SearchInput
        containerClassName="flex-1"
        density="compact"
        value={state.query}
        onChange={(event) => state.setQuery(event.target.value)}
        onClear={() => state.setQuery('')}
        placeholder="Search extensions and capabilities…"
      />
      <FilterBarToggle
        label="Extension filters"
        count={state.activeFilters}
        active={state.activeFilters > 0}
        aria-expanded={state.mobileFiltersOpen}
        aria-controls="extension-filters"
        onClick={() => state.setMobileFiltersOpen((open) => !open)}
      >
        <SlidersHorizontal />
      </FilterBarToggle>
      <FilterBarControls id="extension-filters" open={state.mobileFiltersOpen}>
        <ServerFilters catalogs={catalogs} state={state} />
        <CategoryFilters state={state} />
        <ViewFilters state={state} />
        <LifecycleFilters state={state} />
      </FilterBarControls>
    </FilterBar>
  )
}

function ServerFilters({ catalogs, state }: { catalogs: BackendCatalog[]; state: AppExtensionState }) {
  return (
    <ToolbarGroup className="col-span-2" aria-label="Extension servers">
      <ToolbarLabel>Server</ToolbarLabel>
      <FilterChip active={state.serverId === 'all'} count={catalogs.length} onClick={() => state.setServerId('all')}>
        <Server /> All
      </FilterChip>
      {catalogs.map(({ backend }) => (
        <FilterChip key={backend.id} active={state.serverId === backend.id} onClick={() => state.setServerId(backend.id)}>
          <CircleDot className={backend.connected ? 'text-success' : 'text-warning'} />
          {backend.label}
        </FilterChip>
      ))}
    </ToolbarGroup>
  )
}

function CategoryFilters({ state }: { state: AppExtensionState }) {
  return (
    <ToolbarGroup className="col-span-2" aria-label="Extension categories">
      <ToolbarLabel>Category</ToolbarLabel>
      <FilterChip active={state.category === 'all'} className="shrink-0" onClick={() => state.setCategory('all')}>
        All
      </FilterChip>
      {state.categories.map((item) => (
        <FilterChip key={item} active={state.category === item} className="shrink-0" onClick={() => state.setCategory(item)}>
          {categoryLabel(item)}
        </FilterChip>
      ))}
    </ToolbarGroup>
  )
}

function ViewFilters({ state }: { state: AppExtensionState }) {
  return (
    <ToolbarGroup className="col-span-2" aria-label="Extension view">
      <ToolbarLabel>View</ToolbarLabel>
      <FilterChip active={state.view === 'installed'} count={state.active} onClick={() => state.setView('installed')}>
        Installed
      </FilterChip>
      <FilterChip active={state.view === 'catalog'} count={state.modules.length} onClick={() => state.setView('catalog')}>
        Catalog
      </FilterChip>
    </ToolbarGroup>
  )
}

function LifecycleFilters({ state }: { state: AppExtensionState }) {
  return (
    <ToolbarGroup className="col-span-2" aria-label="Extension status">
      <ToolbarLabel>Status</ToolbarLabel>
      <FilterChip active={state.lifecycle === 'all'} count={state.modules.length} onClick={() => state.setLifecycle('all')}>
        All
      </FilterChip>
      <FilterChip active={state.lifecycle === 'ready'} count={state.ready} onClick={() => state.setLifecycle('ready')}>
        <CircleDot className="text-emerald-400" /> Ready
      </FilterChip>
      <FilterChip active={state.lifecycle === 'attention'} count={state.attention} onClick={() => state.setLifecycle('attention')}>
        <AlertTriangle className="text-amber-400" /> Needs setup
      </FilterChip>
      <FilterChip active={state.lifecycle === 'disabled'} count={state.disabled} onClick={() => state.setLifecycle('disabled')}>
        Disabled
      </FilterChip>
    </ToolbarGroup>
  )
}

function ExtensionResults({ state }: { state: AppExtensionState }) {
  if (state.loading) return <ExtensionLoading view={state.view} />
  if (!state.visible.length) return <ExtensionEmpty />
  if (state.view === 'installed') return <InstalledExtensions state={state} />
  return <ExtensionCatalogGrid state={state} />
}

function ExtensionLoading({ view }: { view: ExtensionCatalogView }) {
  return (
    <div className={cn('grid gap-2', view === 'catalog' && 'md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4')}>
      {[0, 1, 2].map((item) => (
        <div key={item} className={cn('animate-pulse rounded-lg border bg-card/40', view === 'catalog' ? 'h-56' : 'h-16')} />
      ))}
    </div>
  )
}

function ExtensionEmpty() {
  return (
    <Empty className="min-h-52">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Boxes />
        </EmptyMedia>
        <EmptyTitle>No extensions match this view</EmptyTitle>
        <EmptyDescription>Try a different search or category.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function InstalledExtensions({ state }: { state: AppExtensionState }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card/30">
      {state.visible.map((entry) => (
        <ExtensionInstalledRow
          key={entry.key}
          {...extensionEntryProps(state, entry)}
          busy={state.busy === entry.key || state.busy === `cache:${entry.key}`}
          onClearCache={() => void state.clearCache(entry)}
        />
      ))}
    </div>
  )
}

function ExtensionCatalogGrid({ state }: { state: AppExtensionState }) {
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {state.visible.map((entry) => (
        <ExtensionCard key={entry.key} {...extensionEntryProps(state, entry)} busy={state.busy === entry.key} />
      ))}
    </div>
  )
}

function extensionEntryProps(state: AppExtensionState, entry: ExtensionEntry) {
  return {
    module: entry.module,
    backend: entry.backend,
    cache: entry.cache,
    pinned: state.pinned.has(entry.module.id),
    onManage: () => state.setSelectedId(entry.key),
    onTogglePin: () => state.togglePin(entry.module),
    onToggle: (enabled: boolean) => void state.toggle(entry, enabled),
  }
}

function ExtensionDetailSheet({ state, onChanged }: { state: AppExtensionState; onChanged(): Promise<unknown> }) {
  const selected = state.selected
  return (
    <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && state.setSelectedId(null)}>
      {selected ? (
        <ExtensionDetails
          module={selected.module}
          backend={selected.backend}
          cache={selected.cache}
          busy={state.busy === selected.key || state.busy === `cache:${selected.key}`}
          pinned={state.pinned.has(selected.module.id)}
          onTogglePin={() => state.togglePin(selected.module)}
          onToggle={(enabled) => void state.toggle(selected, enabled)}
          onClearCache={() => void state.clearCache(selected)}
          onChanged={onChanged}
        />
      ) : null}
    </Sheet>
  )
}

function ResourceServerScope({
  catalogs,
  selected,
  onSelect,
}: {
  catalogs: BackendCatalog[]
  selected: BackendDescriptor | null
  onSelect(backend: BackendDescriptor): void
}) {
  if (!selected) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Server className="size-3.5" /> Skills and MCP servers are configured per VertexADE server.
      </span>
      <ToolbarGroup aria-label="Resource server">
        <ToolbarLabel>Manage on</ToolbarLabel>
        {catalogs.map(({ backend }) => (
          <FilterChip key={backend.id} active={selected.id === backend.id} onClick={() => onSelect(backend)}>
            <CircleDot className={backend.connected ? 'text-success' : 'text-warning'} />
            {backend.label}
          </FilterChip>
        ))}
      </ToolbarGroup>
    </div>
  )
}

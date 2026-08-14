import { useMemo, useState } from 'react'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import type {
  ExtensionCacheStats,
  ExtensionDiagnostic,
  ModuleCatalog,
  ModuleCatalogCategory,
  ModuleCatalogEntry,
} from '@vertexade/platform-contracts'
import { AlertTriangle, Boxes, CircleDot, PlugZap, SlidersHorizontal, Sparkles } from 'lucide-react'
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
import { api, isModuleCatalogEvent } from '@vertexade/ui/lib/dashboard-api'
import { cn } from '@vertexade/ui/lib/utils'
import { useUiPreferences } from '@vertexade/ui/lib/ui-preferences'
import { extensionAvailableInView, type ExtensionCatalogView } from '../lib/extension-catalog'
import {
  categoryLabel,
  ExtensionCard,
  ExtensionDetails,
  ExtensionInstalledRow,
} from '../components/extensions/extension-catalog-components'

export const Route = createFileRoute('/extensions')({ ssr: false, component: Outlet })

type LifecycleFilter = 'all' | 'ready' | 'attention' | 'disabled'

function matchesLifecycle(module: ModuleCatalogEntry, filter: LifecycleFilter) {
  if (filter === 'all') return true
  if (filter === 'attention') return ['setup-required', 'degraded', 'failed'].includes(module.lifecycle)
  return module.lifecycle === filter
}

export function ExtensionsPage() {
  const catalog = useReactiveApi<ModuleCatalog>({
    key: 'module-catalog',
    load: () => api<ModuleCatalog>('/api/modules'),
    accepts: isModuleCatalogEvent,
  })
  const modules: ModuleCatalogEntry[] = catalog.data?.modules ?? []
  const diagnostics: ExtensionDiagnostic[] = catalog.data?.diagnostics ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ModuleCatalogCategory | 'all'>('all')
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>('all')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const loading = catalog.loading && !catalog.ready
  const [busy, setBusy] = useState('')
  const cacheStats: ExtensionCacheStats[] = catalog.data?.cache ?? []
  const [view, setView] = useState<ExtensionCatalogView>('installed')
  const preferences = useUiPreferences()
  const pinned = useMemo(() => new Set(preferences.value.extensionPins), [preferences.value.extensionPins])
  const categories = useMemo(() => [...new Set(modules.map((module) => module.catalog?.category || 'other'))], [modules])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return modules
      .filter((module) => extensionAvailableInView(module, view))
      .filter((module) => category === 'all' || (module.catalog?.category || 'other') === category)
      .filter((module) => matchesLifecycle(module, lifecycle))
      .filter(
        (module) =>
          !needle ||
          [module.name, module.description, module.catalog?.tagline, ...(module.catalog?.tags || [])].some((value) =>
            value?.toLowerCase().includes(needle),
          ),
      )
      .sort((a, b) => Number(Boolean(b.catalog?.featured)) - Number(Boolean(a.catalog?.featured)) || a.name.localeCompare(b.name))
  }, [category, lifecycle, modules, query, view])
  const selected = modules.find((module) => module.id === selectedId) || null
  const ready = modules.filter((module) => module.lifecycle === 'ready').length
  const active = modules.filter((module) => module.enabled).length
  const attention = modules.filter((module) => ['setup-required', 'degraded', 'failed'].includes(module.lifecycle)).length
  const activeFilters = Number(view !== 'installed') + Number(category !== 'all') + Number(lifecycle !== 'all')

  async function toggle(module: ModuleCatalogEntry, enabled: boolean) {
    setBusy(module.id)
    try {
      await api('/api/settings/extensions', {
        method: 'PATCH',
        body: JSON.stringify({ id: module.id, enabled }),
      })
      toast.success(`${module.name} ${enabled ? 'enabled' : 'disabled'}`)
      await catalog.refresh()
      if (enabled) setSelectedId(module.id)
    } catch (error) {
      toast.error((error as Error).message)
      await catalog.refresh()
    } finally {
      setBusy('')
    }
  }

  async function clearCache(module: ModuleCatalogEntry) {
    setBusy(`cache:${module.id}`)
    try {
      const result = await api<{ removed: number }>(`/api/modules/${encodeURIComponent(module.id)}/cache`, {
        method: 'DELETE',
      })
      toast.success(
        result.removed
          ? `Cleared ${result.removed} cached ${result.removed === 1 ? 'response' : 'responses'}`
          : `${module.name} cache is already clear`,
      )
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

  return (
    <WorkspacePage>
      <WorkspaceHeader
        eyebrow="Tools and integrations"
        title="Extensions"
        description={`${active} active tools${attention ? ` · ${attention} need setup` : ''}. Search, open, or configure one place at a time.`}
      />

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
        </TabsList>

        <TabsContent value="skills">
          <section aria-label="Skills">
            <AgentResourceSettings section="skills" />
          </section>
        </TabsContent>

        <TabsContent value="mcp">
          <section aria-label="MCP servers">
            <AgentResourceSettings section="mcp" />
          </section>
        </TabsContent>

        <TabsContent value="apps">
          <section aria-label="Browse app extensions" className="flex flex-col gap-3">
            {diagnostics.length > 0 && (
              <StatusPanel tone="danger">
                <AlertTriangle />
                <StatusPanelContent>
                  <StatusPanelTitle>
                    {diagnostics.length} extension {diagnostics.length === 1 ? 'problem was' : 'problems were'} isolated
                  </StatusPanelTitle>
                  <StatusPanelDescription>Other extensions remain available.</StatusPanelDescription>
                  <ul className="mt-2 space-y-1 font-mono text-[10px]">
                    {diagnostics.slice(0, 3).map((diagnostic, index) => (
                      <li key={`${diagnostic.moduleId}:${diagnostic.phase}:${index}`} className="break-words">
                        <span className="font-semibold">
                          {diagnostic.moduleId} · {diagnostic.phase}
                        </span>{' '}
                        — {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                  {diagnostics.length > 3 && <StatusPanelDescription>And {diagnostics.length - 3} more.</StatusPanelDescription>}
                </StatusPanelContent>
              </StatusPanel>
            )}
            <FilterBar className="sm:flex-col sm:items-stretch">
              <SearchInput
                containerClassName="flex-1"
                density="compact"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery('')}
                placeholder="Search extensions and capabilities…"
              />
              <FilterBarToggle
                label="Extension filters"
                count={activeFilters}
                active={activeFilters > 0}
                aria-expanded={mobileFiltersOpen}
                aria-controls="extension-filters"
                onClick={() => setMobileFiltersOpen((open) => !open)}
              >
                <SlidersHorizontal />
              </FilterBarToggle>
              <FilterBarControls id="extension-filters" open={mobileFiltersOpen}>
                <ToolbarGroup className="col-span-2" aria-label="Extension categories">
                  <ToolbarLabel>Category</ToolbarLabel>
                  <FilterChip active={category === 'all'} className="shrink-0" onClick={() => setCategory('all')}>
                    All
                  </FilterChip>
                  {categories.map((item) => (
                    <FilterChip key={item} active={category === item} className="shrink-0" onClick={() => setCategory(item)}>
                      {categoryLabel(item)}
                    </FilterChip>
                  ))}
                </ToolbarGroup>
                <ToolbarGroup className="col-span-2" aria-label="Extension view">
                  <ToolbarLabel>View</ToolbarLabel>
                  <FilterChip active={view === 'installed'} count={active} onClick={() => setView('installed')}>
                    Installed
                  </FilterChip>
                  <FilterChip active={view === 'catalog'} count={modules.length} onClick={() => setView('catalog')}>
                    Catalog
                  </FilterChip>
                </ToolbarGroup>
                <ToolbarGroup className="col-span-2" aria-label="Extension status">
                  <ToolbarLabel>Status</ToolbarLabel>
                  <FilterChip active={lifecycle === 'all'} count={modules.length} onClick={() => setLifecycle('all')}>
                    All
                  </FilterChip>
                  <FilterChip active={lifecycle === 'ready'} count={ready} onClick={() => setLifecycle('ready')}>
                    <CircleDot className="text-emerald-400" />
                    Ready
                  </FilterChip>
                  <FilterChip active={lifecycle === 'attention'} count={attention} onClick={() => setLifecycle('attention')}>
                    <AlertTriangle className="text-amber-400" />
                    Needs setup
                  </FilterChip>
                  <FilterChip
                    active={lifecycle === 'disabled'}
                    count={modules.filter((module) => module.lifecycle === 'disabled').length}
                    onClick={() => setLifecycle('disabled')}
                  >
                    Disabled
                  </FilterChip>
                </ToolbarGroup>
              </FilterBarControls>
            </FilterBar>

            {loading ? (
              <div className={cn('grid gap-2', view === 'catalog' && 'md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4')}>
                {[0, 1, 2].map((item) => (
                  <div key={item} className={cn('animate-pulse rounded-lg border bg-card/40', view === 'catalog' ? 'h-56' : 'h-16')} />
                ))}
              </div>
            ) : visible.length ? (
              view === 'installed' ? (
                <div className="overflow-hidden rounded-lg border bg-card/30">
                  {visible.map((module) => (
                    <ExtensionInstalledRow
                      key={module.id}
                      module={module}
                      cache={cacheStats.find((item) => item.namespace === module.id)}
                      busy={busy === module.id || busy === `cache:${module.id}`}
                      pinned={pinned.has(module.id)}
                      onManage={() => setSelectedId(module.id)}
                      onTogglePin={() => togglePin(module)}
                      onToggle={(enabled) => void toggle(module, enabled)}
                      onClearCache={() => void clearCache(module)}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {visible.map((module) => (
                    <ExtensionCard
                      key={module.id}
                      module={module}
                      cache={cacheStats.find((item) => item.namespace === module.id)}
                      busy={busy === module.id}
                      pinned={pinned.has(module.id)}
                      onManage={() => setSelectedId(module.id)}
                      onTogglePin={() => togglePin(module)}
                      onToggle={(enabled) => void toggle(module, enabled)}
                    />
                  ))}
                </div>
              )
            ) : (
              <Empty className="min-h-52">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Boxes />
                  </EmptyMedia>
                  <EmptyTitle>No extensions match this view</EmptyTitle>
                  <EmptyDescription>Try a different search or category.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        {selected && (
          <ExtensionDetails
            module={selected}
            cache={cacheStats.find((item) => item.namespace === selected.id)}
            busy={busy === selected.id || busy === `cache:${selected.id}`}
            pinned={pinned.has(selected.id)}
            onTogglePin={() => togglePin(selected)}
            onToggle={(enabled) => void toggle(selected, enabled)}
            onClearCache={() => void clearCache(selected)}
            onChanged={catalog.refresh}
          />
        )}
      </Sheet>
    </WorkspacePage>
  )
}

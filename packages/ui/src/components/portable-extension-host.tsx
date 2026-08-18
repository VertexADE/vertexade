import type { ModuleCatalogEntry, PortableCollectionSurface } from '@vertexade/platform-contracts'
import type { ComponentType } from 'react'
import { portableRecords, readPortablePath } from '@vertexade/platform-contracts/portable'
import { ArrowLeft, Columns3, LayoutList, RefreshCw, Settings } from 'lucide-react'
import { PortableActionDialog, PortableCard, PortableDetailPage } from '@vertexade/ui/components/portable-extension-detail'
import {
  PortableAxisControl,
  PortableKanban,
  PortableMobileStages,
  PortableMobileToolbar,
  PortableState,
  PortableSwimlaneControl,
} from '@vertexade/ui/components/portable-extension-layout'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Input } from '@vertexade/ui/components/ui/input'
import { SegmentedControl, SegmentedControlItem } from '@vertexade/ui/components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { usePortableCollectionWorkspace } from '@vertexade/ui/hooks/use-portable-collection-workspace'
import { age } from '@vertexade/ui/lib/dashboard-api'
import { cn } from '@vertexade/ui/lib/utils'

type PortableWorkspaceState = ReturnType<typeof usePortableCollectionWorkspace>
type PortableWorkspaceView = 'loading' | 'error' | 'setup' | 'detail' | 'missing-detail' | 'board'

export function PortableExtensionHost({
  module,
  detailId,
  backendId,
  onDetailChange,
}: {
  module: ModuleCatalogEntry
  detailId?: string | null
  backendId?: string
  onDetailChange?(itemId: string | null): void
}) {
  const surface = module.portable?.surfaces.find((candidate): candidate is PortableCollectionSurface => candidate.kind === 'collection')
  if (!surface) return null
  return (
    <PortableCollectionHost module={module} surface={surface} detailId={detailId} backendId={backendId} onDetailChange={onDetailChange} />
  )
}

function PortableCollectionHost({
  module,
  surface,
  detailId,
  backendId,
  onDetailChange,
}: {
  module: ModuleCatalogEntry
  surface: PortableCollectionSurface
  detailId?: string | null
  backendId?: string
  onDetailChange?(itemId: string | null): void
}) {
  const state = usePortableCollectionWorkspace({ module, surface, detailId, backendId, onDetailChange })
  return <PortableCollectionWorkspace state={state} />
}

function PortableCollectionWorkspace({ state }: { state: PortableWorkspaceState }) {
  const View = portableWorkspaceComponents[portableWorkspaceView(state)]
  return <View state={state} />
}

function portableWorkspaceView(state: PortableWorkspaceState): PortableWorkspaceView {
  return portableWorkspaceRules.find((rule) => rule.matches(state))?.view ?? 'board'
}

function initialLoad(state: PortableWorkspaceState) {
  return state.loading && !state.data
}

function initialError(state: PortableWorkspaceState) {
  return Boolean(state.error && !state.data)
}

const portableWorkspaceRules: Array<{ view: PortableWorkspaceView; matches(state: PortableWorkspaceState): boolean }> = [
  { view: 'loading', matches: initialLoad },
  { view: 'error', matches: initialError },
  { view: 'setup', matches: (state) => !state.configured },
  { view: 'detail', matches: (state) => Boolean(state.selectedDetailId && state.detail) },
  { view: 'missing-detail', matches: (state) => Boolean(state.selectedDetailId) },
]

const portableWorkspaceComponents: Record<PortableWorkspaceView, ComponentType<{ state: PortableWorkspaceState }>> = {
  loading: PortableInitialLoading,
  error: PortableInitialError,
  setup: PortableSetupState,
  detail: PortableSelectedDetail,
  'missing-detail': PortableMissingDetail,
  board: PortableCollectionBoard,
}

function PortableInitialLoading({ state }: { state: PortableWorkspaceState }) {
  return <PortableState title={`Loading ${state.surface.title}`} description="Reading the extension's declarative data source…" />
}

function PortableInitialError({ state }: { state: PortableWorkspaceState }) {
  return (
    <PortableState
      title={`${state.surface.title} is unavailable`}
      description={state.error}
      action={
        <Button variant="outline" onClick={() => void state.load(true)}>
          <RefreshCw />
          Retry
        </Button>
      }
    />
  )
}

function PortableSetupState({ state }: { state: PortableWorkspaceState }) {
  return (
    <PortableState
      title={`${state.module.name} needs setup`}
      description={state.surface.setup?.message || 'Configure this extension before using it.'}
      action={
        state.surface.setup && (
          <Button asChild>
            <a href="/extensions">
              <Settings />
              Open settings
            </a>
          </Button>
        )
      }
    />
  )
}

function PortableSelectedDetail({ state }: { state: PortableWorkspaceState }) {
  if (!state.detail) return null
  return (
    <>
      <PortableDetailPage
        actions={state.actionsFor(state.detail)}
        data={state.detailData}
        item={state.detail}
        loading={state.detailLoading}
        onAction={(action) => state.setActionTarget({ item: state.detail, action })}
        onBack={() => state.changeDetail(null)}
        onOpenItem={state.changeDetail}
        surface={state.surface}
      />
      <PortableActionOverlay state={state} />
    </>
  )
}

function PortableMissingDetail({ state }: { state: PortableWorkspaceState }) {
  return (
    <PortableState
      title={state.detailLoading ? 'Loading work item' : 'Work item unavailable'}
      description={
        state.detailLoading
          ? 'Reading the complete item from the extension…'
          : `Item ${state.selectedDetailId} is not available in this collection.`
      }
      action={
        !state.detailLoading ? (
          <Button variant="outline" onClick={() => state.changeDetail(null)}>
            <ArrowLeft />
            Back to board
          </Button>
        ) : undefined
      }
    />
  )
}

function PortableCollectionBoard({ state }: { state: PortableWorkspaceState }) {
  return (
    <section data-portable-collection>
      <PortableMobileStatus state={state} />
      <PortableMobileToolbar
        axis={state.axis}
        baseGroups={state.baseGroups}
        collectionActions={state.collectionActions}
        columnPreferences={state.columnPreferences}
        data={state.data || {}}
        facets={state.facets}
        facetOptions={state.facetOptions}
        fieldNames={state.fieldNames}
        filtersOpen={state.mobileFiltersOpen}
        items={state.items}
        loading={state.loading}
        onAction={(action) => state.setActionTarget({ item: null, action })}
        onAxisChange={state.setAxis}
        onColumnPreferencesChange={state.changeColumnPreferences}
        onFacetsChange={state.setFacets}
        onFiltersOpenChange={state.setMobileFiltersOpen}
        onNestedSwimlanesChange={state.setNestedSwimlanes}
        onQueryChange={state.setQuery}
        onRefresh={() => void state.load(true)}
        onSourceValuesChange={state.setSourceValues}
        onSwimlaneOptionChange={state.setSwimlaneOption}
        onViewChange={state.setView}
        query={state.query}
        sourceValues={state.sourceValues}
        surface={state.surface}
        nestedSwimlanes={state.nestedSwimlanes}
        swimlaneConfig={state.swimlaneConfig}
        swimlaneOption={state.swimlaneOption}
        view={state.view}
      />
      <PortableDesktopControls state={state} />
      {state.view === 'kanban' && state.groups.length > 0 && (
        <PortableMobileStages groups={state.groups} selected={state.mobileGroup} onSelect={state.setMobileGroup} />
      )}
      <PortableCollectionResults state={state} />
      <PortableCollectionPagination state={state} />
      <PortableActionOverlay state={state} />
    </section>
  )
}

function PortableMobileStatus({ state }: { state: PortableWorkspaceState }) {
  return (
    <div className="mb-2 flex min-h-7 items-center justify-between gap-2 px-0.5 text-xs text-muted-foreground sm:hidden">
      <span>
        {state.loading
          ? 'Refreshing connected source…'
          : state.lastSyncedAt
            ? `Synced ${age(state.lastSyncedAt.toISOString())}`
            : 'Waiting for source data'}
      </span>
      {state.error && <span className="text-destructive">Showing last result</span>}
    </div>
  )
}

function PortableDesktopControls({ state }: { state: PortableWorkspaceState }) {
  return (
    <Card className="mb-3 hidden sm:grid" size="sm" layout="divided">
      <CardHeader className="p-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <CardTitle>{state.surface.title}</CardTitle>
            {state.surface.description && <CardDescription className="text-xs">{state.surface.description}</CardDescription>}
            <p className={cn('mt-1 text-xs', state.error ? 'text-destructive' : 'text-muted-foreground')}>{portableSyncText(state)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {state.collectionActions.map((action) => (
              <Button key={action.id} size="sm" onClick={() => state.setActionTarget({ item: null, action })}>
                {action.label}
              </Button>
            ))}
            <Button variant="outline" size="sm" loading={state.loading} loadingText="Refreshing…" onClick={() => void state.load(true)}>
              <RefreshCw />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <PortablePrimaryControls state={state} />
      <PortableSourceControls state={state} />
    </Card>
  )
}

function portableSyncText(state: PortableWorkspaceState) {
  return portableSyncStates.find((candidate) => candidate.active(state))?.text(state) ?? 'Waiting for source data'
}

const portableSyncStates = [
  { active: (state: PortableWorkspaceState) => state.loading, text: () => 'Refreshing connected source…' },
  {
    active: (state: PortableWorkspaceState) => Boolean(state.error),
    text: (state: PortableWorkspaceState) => `Refresh failed · showing data synced ${state.lastSyncedAt ? syncedAge(state) : 'earlier'}`,
  },
  { active: (state: PortableWorkspaceState) => Boolean(state.lastSyncedAt), text: syncedText },
]

function syncedAge(state: PortableWorkspaceState) {
  return age(state.lastSyncedAt!.toISOString())
}

function syncedText(state: PortableWorkspaceState) {
  return `Connected source synced ${syncedAge(state)}`
}

function PortablePrimaryControls({ state }: { state: PortableWorkspaceState }) {
  return (
    <CardContent className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_13rem_auto_13rem_13rem]">
      <Input
        aria-label="Search records"
        placeholder="Search records…"
        value={state.query}
        onChange={(event) => state.setQuery(event.target.value)}
      />
      <Select value={state.sort} onValueChange={state.setSort}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="title">Sort by title</SelectItem>
          {state.fieldNames.map((field) => (
            <SelectItem key={field} value={field}>
              Sort by {field}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <PortableViewControl state={state} />
      <PortableBoardControls state={state} />
    </CardContent>
  )
}

function PortableViewControl({ state }: { state: PortableWorkspaceState }) {
  const enableKanban = () => {
    state.setView('kanban')
    state.setAxis((current) => current || state.fieldNames[0] || '')
  }
  return (
    <SegmentedControl aria-label="Collection view">
      <SegmentedControlItem active={state.view === 'list'} onClick={() => state.setView('list')}>
        <LayoutList />
        List
      </SegmentedControlItem>
      {state.surface.views.kanban?.enabled && (
        <SegmentedControlItem active={state.view === 'kanban'} onClick={enableKanban}>
          <Columns3 />
          Kanban
        </SegmentedControlItem>
      )}
    </SegmentedControl>
  )
}

function PortableBoardControls({ state }: { state: PortableWorkspaceState }) {
  if (state.view !== 'kanban') return null
  return (
    <>
      <PortableAxisControl
        axis={state.axis}
        fieldNames={state.fieldNames}
        groups={state.baseGroups}
        onAxisChange={state.setAxis}
        onPreferencesChange={state.changeColumnPreferences}
        preferences={state.columnPreferences}
      />
      {state.swimlaneConfig && (
        <PortableSwimlaneControl
          config={state.swimlaneConfig}
          nested={state.nestedSwimlanes}
          onNestedChange={state.setNestedSwimlanes}
          onOptionChange={state.setSwimlaneOption}
          option={state.swimlaneOption}
        />
      )}
    </>
  )
}

function PortableSourceControls({ state }: { state: PortableWorkspaceState }) {
  const controls = [
    ...(state.surface.sourceControls ?? []).map((control) => <PortableSourceSelect key={control.id} state={state} control={control} />),
    ...(state.surface.facets ?? []).map((facet) => <PortableFacetSelect key={facet.id} state={state} facet={facet} />),
  ]
  return controls.length ? <CardContent className="grid grid-cols-2 gap-2 border-t p-3 sm:flex sm:flex-wrap">{controls}</CardContent> : null
}

type SourceControl = NonNullable<PortableCollectionSurface['sourceControls']>[number]
type FacetControl = NonNullable<PortableCollectionSurface['facets']>[number]

function portableControlOptions(state: PortableWorkspaceState, control: SourceControl) {
  return portableRecords(readPortablePath(state.data, control.optionsPath)).map((option) => {
    const value = String(readPortablePath(option, control.optionValuePath) ?? '')
    return { value, label: String(readPortablePath(option, control.optionLabelPath) ?? value) }
  })
}

function PortableSourceSelect({ state, control }: { state: PortableWorkspaceState; control: SourceControl }) {
  const change = (value: string) => state.setSourceValues((current) => ({ ...current, [control.id]: value }))
  return (
    <Select value={state.sourceValues[control.id] ?? ''} onValueChange={change}>
      <SelectTrigger className="w-full sm:w-60">
        <SelectValue placeholder={control.label} />
      </SelectTrigger>
      <SelectContent>
        {portableControlOptions(state, control).map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function PortableFacetSelect({ state, facet }: { state: PortableWorkspaceState; facet: FacetControl }) {
  const change = (value: string) => state.setFacets((current) => ({ ...current, [facet.id]: value === '__all' ? '' : value }))
  return (
    <Select value={state.facets[facet.id] ?? '__all'} onValueChange={change}>
      <SelectTrigger className="w-full sm:w-52">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">All {facet.label.toLowerCase()}</SelectItem>
        {state.facetOptions[facet.id]?.map((value) => (
          <SelectItem key={value} value={value}>
            {value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function PortableCollectionResults({ state }: { state: PortableWorkspaceState }) {
  if (!state.visible.length)
    return (
      <PortableState
        title="No records found"
        description={state.query ? 'Try a different search.' : 'The connected collection is empty.'}
      />
    )
  return state.view === 'list' ? <PortableListResults state={state} /> : <PortableKanbanResults state={state} />
}

function PortableListResults({ state }: { state: PortableWorkspaceState }) {
  return (
    <div className="overflow-hidden rounded-lg bg-card/35 ring-1 ring-foreground/10">
      {state.shown.map((item) => (
        <PortableCard
          key={item.id}
          compact
          item={item}
          actions={state.actionsFor(item)}
          onDetails={state.openDetails}
          onAction={(action) => state.setActionTarget({ item, action })}
        />
      ))}
    </div>
  )
}

function PortableKanbanResults({ state }: { state: PortableWorkspaceState }) {
  if (!state.axis)
    return (
      <PortableState title="Choose a Kanban axis" description="Configure at least one card field, then select it as the grouping axis." />
    )
  return (
    <PortableKanban
      groups={state.groups}
      lanes={state.swimlanes}
      limit={state.effectiveLimit}
      selected={state.mobileGroup}
      actionsFor={state.actionsFor}
      onDetails={state.openDetails}
      onAction={(item, action) => state.setActionTarget({ item, action })}
    />
  )
}

function PortableCollectionPagination({ state }: { state: PortableWorkspaceState }) {
  if (!state.paginated) return null
  return (
    <>
      {state.mobileRemaining > 0 && (
        <PortableShowMore
          className="sm:hidden"
          displayed={state.mobileDisplayed}
          total={state.mobileTotal}
          onShowMore={() => state.setLimit((current) => current + 12)}
        />
      )}
      {state.remaining > 0 && (
        <PortableShowMore
          className="hidden sm:flex"
          displayed={state.displayed}
          total={state.displayable}
          onShowMore={() => state.setLimit((current) => current + 12)}
        />
      )}
    </>
  )
}

function PortableShowMore({
  className,
  displayed,
  total,
  onShowMore,
}: {
  className: string
  displayed: number
  total: number
  onShowMore(): void
}) {
  return (
    <div className={cn('mt-3 items-center justify-between rounded-lg border bg-card/35 px-3 py-2', className)}>
      <span className="text-xs text-muted-foreground">
        Showing {displayed} of {total}
      </span>
      <Button variant="outline" size="sm" onClick={onShowMore}>
        Show 12 more
      </Button>
    </div>
  )
}

function PortableActionOverlay({ state }: { state: PortableWorkspaceState }) {
  if (!state.actionTarget) return null
  return (
    <PortableActionDialog
      action={state.actionTarget.action}
      item={state.actionTarget.item}
      data={state.data || {}}
      extension={state.extension}
      onClose={() => state.setActionTarget(null)}
      onCompleted={state.load}
    />
  )
}

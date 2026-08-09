import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ModuleCatalogEntry,
  PortableCollectionAction,
  PortableCollectionSurface,
  PortableItemAction,
} from '@vertexade/platform-contracts'
import type { PlatformExtensionClient } from '@vertexade/platform-client'
import { usePortableCollectionSource } from '@vertexade/platform-client/react'
import {
  portableRecords,
  projectPortableCollection,
  projectPortableSwimlanes,
  readPortablePath,
  type PortableCollectionItem,
} from '@vertexade/platform-contracts/portable'
import {
  filterPortableItems,
  portableFacetOptions,
  portableFieldNames,
  portableGroupOrder,
  portablePagination,
  projectPortableGroups,
  type PortableActionTarget,
  type PortableSourceData,
  type PortableViewMode,
} from '../components/portable-extension-model'
import { eventReason, platformClient, subscribeToDashboardEvents } from '@vertexade/ui/lib/dashboard-api'
import { usePortableSourceRefresh } from '@vertexade/ui/lib/portable-source-refresh'
import { usePortableBoardPreferences } from './use-portable-board-preferences'
import { usePortableDetail } from './use-portable-detail'

function pageSize(surface: PortableCollectionSurface) {
  return surface.views.pagination?.pageSize ?? 12
}

function initialView(surface: PortableCollectionSurface): PortableViewMode {
  return surface.views.default ?? 'list'
}

function initialAxis(surface: PortableCollectionSurface) {
  return surface.views.kanban?.defaultField ?? ''
}

function selectedDetailId(controlled: string | null | undefined, local: string | null) {
  return controlled === undefined ? local : controlled
}

function boardDetail(items: PortableCollectionItem[], itemId: string | null) {
  return itemId ? (items.find((item) => item.id === itemId) ?? null) : null
}

function collectionConfigured(data: unknown, surface: PortableCollectionSurface) {
  const path = surface.source.configuredPath
  return path ? readPortablePath(data, path) !== false : true
}

function usePortableSource(moduleId: string, extension: PlatformExtensionClient, surface: PortableCollectionSurface) {
  const source = usePortableCollectionSource<PortableSourceData>({ extension, surface })
  usePortableSourceRefresh({ load: source.load, polling: Boolean(surface.refresh), surfaceKey: `${moduleId}:${surface.id}` })
  useEffect(() => {
    const prefixes = surface.refresh?.eventPrefixes ?? []
    if (!prefixes.length) return
    return subscribeToDashboardEvents(
      () => void source.load(),
      (event) => prefixes.some((prefix) => eventReason(event).startsWith(prefix)),
    )
  }, [source.load, surface.refresh?.eventPrefixes])
  return source
}

function usePortableControls(surface: PortableCollectionSurface) {
  const size = pageSize(surface)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('title')
  const [view, setView] = useState<PortableViewMode>(() => initialView(surface))
  const [axis, setAxis] = useState(() => initialAxis(surface))
  const [limit, setLimit] = useState(size)
  const [facets, setFacets] = useState<Record<string, string>>({})
  const [localDetailId, setLocalDetailId] = useState<string | null>(null)
  const [actionTarget, setActionTarget] = useState<PortableActionTarget | null>(null)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [mobileGroup, setMobileGroup] = useState('')

  useEffect(() => setLimit(size), [axis, facets, query, size, sort, view])
  return {
    query,
    setQuery,
    sort,
    setSort,
    view,
    setView,
    axis,
    setAxis,
    limit,
    setLimit,
    facets,
    setFacets,
    localDetailId,
    setLocalDetailId,
    actionTarget,
    setActionTarget,
    mobileFiltersOpen,
    setMobileFiltersOpen,
    mobileGroup,
    setMobileGroup,
  }
}

function usePortableSelection({
  module,
  surface,
  extension,
  items,
  detailId,
  onDetailChange,
  controls,
}: {
  module: ModuleCatalogEntry
  surface: PortableCollectionSurface
  extension: PlatformExtensionClient
  items: PortableCollectionItem[]
  detailId?: string | null
  onDetailChange?(itemId: string | null): void
  controls: ReturnType<typeof usePortableControls>
}) {
  const swimlaneConfig = surface.views.kanban?.swimlanes
  const preferences = usePortableBoardPreferences({
    moduleId: module.id,
    surfaceId: surface.id,
    swimlanes: swimlaneConfig,
    axis: controls.axis,
  })
  const selectedId = selectedDetailId(detailId, controls.localDetailId)
  const detailState = usePortableDetail({ extension, surface, selectedId, boardItem: boardDetail(items, selectedId) })
  const { setLocalDetailId } = controls
  const { reset } = detailState
  const changeDetail = useCallback(
    (itemId: string | null) => {
      reset()
      if (detailId === undefined) setLocalDetailId(itemId)
      onDetailChange?.(itemId)
    },
    [detailId, onDetailChange, reset, setLocalDetailId],
  )
  return { swimlaneConfig, ...preferences, selectedDetailId: selectedId, ...detailState, changeDetail }
}

function collectionActions(data: unknown, surface: PortableCollectionSurface) {
  return [
    ...(surface.collectionActions ?? []),
    ...(portableRecords(readPortablePath(data, surface.collectionActionsPath)).filter(
      (action) => typeof action.id === 'string',
    ) as PortableCollectionAction[]),
  ]
}

function itemActions(item: PortableCollectionItem, surface: PortableCollectionSurface) {
  return [
    ...(surface.actions ?? []),
    ...(portableRecords(readPortablePath(item.raw, surface.itemActionsPath)).filter(
      (action) => typeof action.id === 'string',
    ) as PortableItemAction[]),
  ]
}

function usePortableProjection({
  data,
  surface,
  items,
  controls,
  selection,
}: {
  data: PortableSourceData | null
  surface: PortableCollectionSurface
  items: PortableCollectionItem[]
  controls: ReturnType<typeof usePortableControls>
  selection: ReturnType<typeof usePortableSelection>
}) {
  const fieldNames = useMemo(() => portableFieldNames(data, surface), [data, surface])
  const visible = useMemo(
    () => filterPortableItems(items, controls.query, controls.sort, controls.facets, surface.facets),
    [controls.facets, controls.query, controls.sort, items, surface.facets],
  )
  const order = useMemo(() => portableGroupOrder(data, surface, controls.axis), [controls.axis, data, surface])
  const projectedGroups = useMemo(
    () => projectPortableGroups(visible, controls.axis, order, selection.columnPreferences),
    [controls.axis, order, selection.columnPreferences, visible],
  )
  const pagination = useMemo(
    () =>
      portablePagination(
        controls.view,
        visible,
        projectedGroups.groups,
        controls.mobileGroup,
        controls.limit,
        surface.views.pagination?.enabled !== false,
      ),
    [controls.limit, controls.mobileGroup, controls.view, projectedGroups.groups, surface.views.pagination?.enabled, visible],
  )
  const facetOptions = useMemo(() => portableFacetOptions(items, surface.facets), [items, surface.facets])
  const actionsFor = useCallback((item: PortableCollectionItem) => itemActions(item, surface), [surface])
  const selectedSwimlane = selection.swimlaneConfig?.options.find((option) => option.id === selection.swimlaneOption)
  const swimlanes = useMemo(
    () => (selectedSwimlane ? projectPortableSwimlanes(visible, selectedSwimlane, selection.nestedSwimlanes) : []),
    [selectedSwimlane, selection.nestedSwimlanes, visible],
  )
  return {
    fieldNames,
    visible,
    ...projectedGroups,
    ...pagination,
    configured: collectionConfigured(data, surface),
    collectionActions: collectionActions(data, surface),
    facetOptions,
    actionsFor,
    swimlanes,
  }
}

function useMobileGroupSelection(
  groups: ReturnType<typeof projectPortableGroups>['groups'],
  controls: ReturnType<typeof usePortableControls>,
) {
  useEffect(() => {
    const next = nextMobileGroup(groups, controls.mobileGroup)
    if (next) controls.setMobileGroup(next)
  }, [controls.mobileGroup, controls.setMobileGroup, groups])
}

function nextMobileGroup(groups: ReturnType<typeof projectPortableGroups>['groups'], current: string) {
  if (!groups.length) return ''
  if (groups.some((group) => group.name === current)) return ''
  return preferredMobileGroup(groups).name
}

function preferredMobileGroup(groups: ReturnType<typeof projectPortableGroups>['groups']) {
  return groups.find((group) => /active|progress|doing|committed/i.test(group.name)) ?? groups[0]!
}

export function usePortableCollectionWorkspace({
  module,
  surface,
  detailId,
  onDetailChange,
}: {
  module: ModuleCatalogEntry
  surface: PortableCollectionSurface
  detailId?: string | null
  onDetailChange?(itemId: string | null): void
}) {
  const extension = useMemo(() => platformClient.extension(module.id), [module.id])
  const source = usePortableSource(module.id, extension, surface)
  const items = useMemo(() => projectPortableCollection(source.data, surface), [source.data, surface])
  const controls = usePortableControls(surface)
  const sourcePageSize = pageSize(surface)
  useEffect(() => controls.setLimit(sourcePageSize), [controls.setLimit, source.sourceValues, sourcePageSize])
  const selection = usePortableSelection({ module, surface, extension, items, detailId, onDetailChange, controls })
  const projection = usePortableProjection({ data: source.data, surface, items, controls, selection })
  useMobileGroupSelection(projection.groups, controls)
  const { changeDetail } = selection
  const openDetails = useCallback((item: PortableCollectionItem) => changeDetail(item.id), [changeDetail])

  return {
    module,
    surface,
    extension,
    ...source,
    items,
    ...controls,
    paginated: surface.views.pagination?.enabled !== false,
    ...selection,
    ...projection,
    openDetails,
  }
}

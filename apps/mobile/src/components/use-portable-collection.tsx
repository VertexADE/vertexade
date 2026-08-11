import { useCallback, useMemo, useState } from 'react'
import type { ModuleCatalogEntry, PortableCollectionSurface, PortableItemAction } from '@vertexade/platform-contracts'
import { usePortableCollectionSource } from '@vertexade/platform-client/react'
import {
  projectPortableCollection,
  readPortablePath,
  type PortableCollectionItem,
} from '@vertexade/platform-contracts/portable'
import {
  collectionActions,
  collectionFacetOptions,
  collectionFieldNames,
  filterCollectionItems,
  groupCollectionItems,
  itemActions,
} from './portable-collection-projection'
import { usePortableSourceRefresh } from './use-portable-source-refresh'
import { createMobilePlatformClient } from '@/platform-service'

type SourceData = Record<string, unknown>
type ViewMode = 'list' | 'kanban'
type ActionTarget = { item: PortableCollectionItem | null; action: PortableItemAction }

export function usePortableCollection({ module, serviceUrl, backendId, surface }: {
  module: ModuleCatalogEntry
  serviceUrl: string
  backendId: string
  surface: PortableCollectionSurface
}) {
  const extension = useMemo(
    () => createMobilePlatformClient(serviceUrl, backendId).extension(module.id),
    [backendId, module.id, serviceUrl],
  )
  const {
    data,
    loading,
    error,
    setError,
    sourceValues,
    setSourceValues,
    load,
  } = usePortableCollectionSource<SourceData>({ extension, surface })
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewMode>('list')
  const [sort, setSort] = useState('title')
  const [axis, setAxis] = useState('')
  const [facets, setFacets] = useState<Record<string, string>>({})
  const [detail, setDetail] = useState<PortableCollectionItem | null>(null)
  const [detailData, setDetailData] = useState<unknown>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null)
  usePortableSourceRefresh({
    load,
    polling: Boolean(surface.refresh),
    surfaceKey: `${module.id}:${surface.id}`,
  })

  const items = useMemo(() => projectPortableCollection(data, surface), [data, surface])
  const fieldNames = useMemo(() => collectionFieldNames(data, surface), [data, surface])
  const visible = useMemo(() => filterCollectionItems(items, surface, query, facets, sort), [facets, items, query, sort, surface])
  const groups = useMemo(() => groupCollectionItems(visible, axis), [axis, visible])
  const configured = surface.source.configuredPath ? readPortablePath(data, surface.source.configuredPath) !== false : true
  const actionsFor = useCallback((item: PortableCollectionItem) => itemActions(item, surface), [surface])
  const availableCollectionActions = useMemo(() => collectionActions(data, surface), [data, surface])
  const facetOptions = useMemo(() => collectionFacetOptions(items, surface), [items, surface])

  async function openDetails(item: PortableCollectionItem) {
    setDetail(item)
    setDetailData(null)
    if (!surface.detail?.source) return
    setDetailLoading(true)
    try {
      setDetailData(await extension.request(surface.detail.source.path.replaceAll('{id}', encodeURIComponent(item.id))))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load details')
    } finally {
      setDetailLoading(false)
    }
  }

  return {
    extension, data, loading, error, query, setQuery, view, setView, sort, setSort, axis, setAxis,
    facets, setFacets, sourceValues, setSourceValues, detail, setDetail, detailData, detailLoading,
    actionTarget, setActionTarget, load, fieldNames, visible, groups, configured, actionsFor,
    collectionActions: availableCollectionActions, facetOptions, openDetails,
  }
}

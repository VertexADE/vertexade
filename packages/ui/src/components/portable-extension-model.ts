import type {
  ExtensionBoardPreferences,
  PortableCollectionSurface,
  PortableItemAction,
  PortableSwimlaneConfig,
} from '@vertexade/platform-contracts'
import {
  orderPortableGroups,
  orderPortableHierarchy,
  portableRecords,
  readPortablePath,
  type PortableCollectionItem,
} from '@vertexade/platform-contracts/portable'

export type PortableViewMode = 'list' | 'kanban'
export type PortableSourceData = Record<string, unknown>
export type PortableGroup = { name: string; items: PortableCollectionItem[] }
export type PortableColumnPreferences = { order: string[]; hidden: string[] }
export type PortableActionTarget = { item: PortableCollectionItem | null; action: PortableItemAction }

export function portableBoardPreferenceKey(moduleId: string, surfaceId: string) {
  return `${moduleId}:${surfaceId}`
}

export function defaultPortableBoardPreferences(swimlanes: PortableSwimlaneConfig | undefined): ExtensionBoardPreferences {
  return {
    swimlaneOption: swimlanes?.defaultOption || 'none',
    nestedSwimlanes: Boolean(swimlanes?.nestedByDefault),
    columnsByAxis: {},
  }
}

export function validPortableBoardPreferences(
  stored: ExtensionBoardPreferences,
  fallback: ExtensionBoardPreferences,
  swimlanes: PortableSwimlaneConfig | undefined,
): ExtensionBoardPreferences {
  return {
    ...stored,
    swimlaneOption: swimlanes?.options.some((option) => option.id === stored.swimlaneOption)
      ? stored.swimlaneOption
      : fallback.swimlaneOption,
  }
}

export function filterPortableItems(
  items: PortableCollectionItem[],
  query: string,
  sort: string,
  facets: Record<string, string>,
  surfaceFacets: PortableCollectionSurface['facets'],
) {
  const needle = query.trim().toLowerCase()
  const filtered = items
    .filter((item) => portableSearchText(item).includes(needle))
    .filter((item) => matchesPortableFacets(item, facets, surfaceFacets))

  return orderPortableHierarchy(filtered, (left, right) => {
    return portableSortValue(left, sort).localeCompare(portableSortValue(right, sort))
  })
}

function portableSearchText(item: PortableCollectionItem) {
  return `${item.title} ${item.fields.map((field) => field.value).join(' ')}`.toLowerCase()
}

function matchesPortableFacet(
  item: PortableCollectionItem,
  facet: NonNullable<PortableCollectionSurface['facets']>[number],
  selected: string,
) {
  if (!selected) return true
  return item.fields.find((field) => field.name === facet.field)?.value === selected
}

function matchesPortableFacets(
  item: PortableCollectionItem,
  selected: Record<string, string>,
  facets: PortableCollectionSurface['facets'],
) {
  return (facets ?? []).every((facet) => matchesPortableFacet(item, facet, selected[facet.id] ?? ''))
}

function portableSortValue(item: PortableCollectionItem, sort: string) {
  if (sort === 'title') return item.title
  return item.fields.find((field) => field.name === sort)?.value ?? ''
}

export function portableFieldNames(data: unknown, surface: PortableCollectionSurface) {
  const config = surface.views.kanban
  if (!config) return []
  return portableRecords(readPortablePath(data, config.groupFieldsPath))
    .map((field) => String(readPortablePath(field, config.groupFieldNamePath) || ''))
    .filter(Boolean)
}

export function portableGroupOrder(data: unknown, surface: PortableCollectionSurface, axis: string) {
  const config = surface.views.kanban
  if (!config) return []
  return [
    ...new Set([...defaultGroupOrder(config, axis), ...providedGroupOrder(data, config, axis), ...dynamicGroupOrder(data, config, axis)]),
  ]
}

type PortableKanbanConfig = NonNullable<PortableCollectionSurface['views']['kanban']>

function defaultGroupOrder(config: PortableKanbanConfig, axis: string) {
  if (axis !== config.defaultField) return []
  return config.groupOrder ?? []
}

function pathValues(data: unknown, path: string | undefined, valuePath: string | undefined) {
  if (!path) return []
  if (!valuePath) return []
  return portableRecords(readPortablePath(data, path))
    .map((entry) => String(readPortablePath(entry, valuePath) ?? ''))
    .filter(Boolean)
}

function providedGroupOrder(data: unknown, config: PortableKanbanConfig, axis: string) {
  if (axis !== config.defaultField) return []
  return pathValues(data, config.groupOrderPath, config.groupOrderValuePath)
}

function missingPath(value: string | undefined) {
  return !value
}

function dynamicGroupOrder(data: unknown, config: PortableKanbanConfig, axis: string) {
  const paths = [config.groupOrderEntriesPath, config.groupOrderEntryFieldPath, config.groupOrderEntryValuePath]
  if (paths.some(missingPath)) return []
  return portableRecords(readPortablePath(data, paths[0]))
    .filter((entry) => String(readPortablePath(entry, paths[1])) === axis)
    .map((entry) => String(readPortablePath(entry, paths[2]) ?? ''))
    .filter(Boolean)
}

function portableItemsByGroup(items: PortableCollectionItem[], axis: string) {
  const result = new Map<string, PortableCollectionItem[]>()
  for (const item of items) {
    const value = portableGroupName(item, axis)
    const existing = result.get(value)
    result.set(value, existing ? [...existing, item] : [item])
  }
  return result
}

function portableGroupName(item: PortableCollectionItem, axis: string) {
  const field = item.fields.find((candidate) => candidate.name === axis)
  if (field?.relations.length) return field.relations.map((relation) => relation.title).join(', ')
  return field?.value ?? 'No value'
}

export function projectPortableGroups(
  items: PortableCollectionItem[],
  axis: string,
  groupOrder: string[],
  preferences: PortableColumnPreferences = { order: [], hidden: [] },
) {
  const byGroup = portableItemsByGroup(items, axis)
  const available = [...new Set([...byGroup.keys(), ...groupOrder])].sort((left, right) => left.localeCompare(right))
  const baseGroups = orderPortableGroups(available, groupOrder).map((name) => ({ name, items: byGroup.get(name) || [] }))
  const groups = orderPortableGroups(available, groupOrder, preferences.order, preferences.hidden).map((name) => ({
    name,
    items: byGroup.get(name) || [],
  }))
  return { baseGroups, groups }
}

export function portableFacetOptions(items: PortableCollectionItem[], facets: PortableCollectionSurface['facets']) {
  return Object.fromEntries(
    (facets || []).map((facet) => [
      facet.id,
      [...new Set(items.map((item) => item.fields.find((field) => field.name === facet.field)?.value).filter(Boolean) as string[])].sort(),
    ]),
  )
}

export function portablePagination(
  view: PortableViewMode,
  visible: PortableCollectionItem[],
  groups: PortableGroup[],
  mobileGroup: string,
  limit: number,
  paginated: boolean,
) {
  const effectiveLimit = paginated ? limit : Number.MAX_SAFE_INTEGER
  const shown = visible.slice(0, effectiveLimit)
  const selectedGroup = groups.find((group) => group.name === mobileGroup) || groups[0]
  const displayable = view === 'list' ? visible.length : groups.reduce((total, group) => total + group.items.length, 0)
  const displayed =
    view === 'list' ? shown.length : groups.reduce((total, group) => total + Math.min(group.items.length, effectiveLimit), 0)
  const mobileTotal = view === 'list' ? visible.length : selectedGroup?.items.length || 0
  const mobileDisplayed = view === 'list' ? shown.length : Math.min(mobileTotal, effectiveLimit)
  return {
    effectiveLimit,
    shown,
    selectedGroup,
    displayable,
    displayed,
    remaining: displayable - displayed,
    mobileTotal,
    mobileDisplayed,
    mobileRemaining: mobileTotal - mobileDisplayed,
  }
}

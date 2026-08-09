import type { PortableCollectionAction, PortableCollectionSurface, PortableItemAction } from '@vertexade/platform-contracts'
import { readPortablePath, type PortableCollectionItem } from '@vertexade/platform-contracts/portable'

export function portableRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []
}

export function collectionFieldNames(data: unknown, surface: PortableCollectionSurface) {
  const config = surface.views.kanban
  return config ? portableRecords(readPortablePath(data, config.groupFieldsPath)).map((field) => String(readPortablePath(field, config.groupFieldNamePath) || '')).filter(Boolean) : []
}

export function filterCollectionItems(items: PortableCollectionItem[], surface: PortableCollectionSurface, query: string, facets: Record<string, string>, sort: string) {
  return items
    .filter((item) => `${item.title} ${item.fields.map((field) => field.value).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((item) => (surface.facets || []).every((facet) => !facets[facet.id] || item.fields.find((field) => field.name === facet.field)?.value === facets[facet.id]))
    .sort((left, right) => {
      const leftValue = sort === 'title' ? left.title : left.fields.find((field) => field.name === sort)?.value || ''
      const rightValue = sort === 'title' ? right.title : right.fields.find((field) => field.name === sort)?.value || ''
      return leftValue.localeCompare(rightValue)
    })
}

export function groupCollectionItems(items: PortableCollectionItem[], axis: string) {
  const result = new Map<string, PortableCollectionItem[]>()
  for (const item of items) {
    const field = item.fields.find((candidate) => candidate.name === axis)
    const value = field?.relations.length ? field.relations.map((relation) => relation.title).join(', ') : field?.value || 'No value'
    result.set(value, [...(result.get(value) || []), item])
  }
  return [...result.entries()].map(([name, groupItems]) => ({ name, items: groupItems }))
}

export function itemActions(item: PortableCollectionItem, surface: PortableCollectionSurface) {
  return [
    ...(surface.actions || []),
    ...portableRecords(readPortablePath(item.raw, surface.itemActionsPath)).filter((action) => typeof action.id === 'string') as PortableItemAction[],
  ]
}

export function collectionActions(data: unknown, surface: PortableCollectionSurface) {
  return [
    ...(surface.collectionActions || []),
    ...portableRecords(readPortablePath(data, surface.collectionActionsPath)).filter((action) => typeof action.id === 'string') as PortableCollectionAction[],
  ]
}

export function collectionFacetOptions(items: PortableCollectionItem[], surface: PortableCollectionSurface) {
  return Object.fromEntries((surface.facets || []).map((facet) => [
    facet.id,
    [...new Set(items.map((item) => item.fields.find((field) => field.name === facet.field)?.value).filter(Boolean) as string[])].sort(),
  ]))
}

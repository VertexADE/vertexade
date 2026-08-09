import type {
  PortableCollectionItemMapping,
  PortableCollectionSurface,
  PortableActionInput,
  PortableActionValue,
  PortableFieldPlacement,
  PortableFieldStyle,
  PortableItemAction,
  PortableSettingsField,
  PortableSettingsSurface,
  PortableSwimlaneOption,
} from './index.ts'

export type PortableRelationItem = { id: string; title: string; url?: string; imageUrl?: string }
export type PortableField = {
  name: string
  value: string
  style: PortableFieldStyle
  placement: PortableFieldPlacement
  imageUrl?: string
  relations: PortableRelationItem[]
}
export type PortableCollectionItem = {
  id: string
  title: string
  subtitle: string
  fields: PortableField[]
  raw: Record<string, unknown>
  parentId?: string
  depth: number
}
export type PortableHierarchyLane = {
  id: string
  root: PortableCollectionItem
  items: PortableCollectionItem[]
}
export type PortableSwimlane = {
  id: string
  label: string
  items: PortableCollectionItem[]
  anchor?: PortableCollectionItem
  depth: number
  parentId?: string
}

export function readPortablePath(value: unknown, path: string | undefined): unknown {
  if (!path) return undefined
  return path
    .split('.')
    .reduce<unknown>(
      (current, segment) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined),
      value,
    )
}

function portableText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(portableText).filter(Boolean).join(', ')
  return ''
}

export function portableRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function portableExternalUrl(value: unknown) {
  const text = portableText(value)
  if (!text) return ''
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function portableImageUrl(value: unknown) {
  const text = portableText(value)
  if (/^\/api\/extensions\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~/?=&%+-]+$/.test(text)) return text
  return portableExternalUrl(value)
}

function portableField(field: Record<string, unknown>, mapping: PortableCollectionItemMapping): PortableField {
  const style = portableText(readPortablePath(field, mapping.fieldStylePath))
  const placement = portableText(readPortablePath(field, mapping.fieldPlacementPath))
  const relationRoot = readPortablePath(field, mapping.relationItemsPath)
  const imageUrl = portableImageUrl(readPortablePath(field, mapping.fieldImagePath))
  return {
    name: portableText(readPortablePath(field, mapping.fieldNamePath)),
    value: portableText(readPortablePath(field, mapping.fieldValuePath)),
    style: ['badge', 'date', 'person', 'links'].includes(style) ? (style as PortableFieldStyle) : 'text',
    placement: placement === 'detail' ? 'detail' : 'card',
    ...(imageUrl ? { imageUrl } : {}),
    relations: portableRecords(relationRoot)
      .map((relation) => {
        const url = portableExternalUrl(readPortablePath(relation, mapping.relationUrlPath))
        const relationImage = portableImageUrl(readPortablePath(relation, mapping.relationImagePath))
        return {
          id: portableText(readPortablePath(relation, mapping.relationIdPath)),
          title: portableText(readPortablePath(relation, mapping.relationTitlePath)),
          ...(url ? { url } : {}),
          ...(relationImage ? { imageUrl: relationImage } : {}),
        }
      })
      .filter((relation) => relation.id || relation.title),
  }
}

export function projectPortableCollection(data: unknown, surface: PortableCollectionSurface): PortableCollectionItem[] {
  const items = portableRecords(readPortablePath(data, surface.source.itemsPath)).map((item) => {
    const parentId = portableText(readPortablePath(item, surface.views.hierarchy?.parentIdPath))
    return {
      id: portableText(readPortablePath(item, surface.item.idPath)),
      title: portableText(readPortablePath(item, surface.item.titlePath)) || 'Untitled',
      subtitle: portableText(readPortablePath(item, surface.item.subtitlePath)),
      fields: portableRecords(readPortablePath(item, surface.item.fieldsPath)).map((field) => portableField(field, surface.item)),
      raw: item,
      ...(parentId ? { parentId } : {}),
      depth: 0,
    }
  })
  const byId = new Map(items.map((item) => [item.id, item]))
  const depth = (item: PortableCollectionItem, seen = new Set<string>()): number => {
    if (!item.parentId || seen.has(item.id)) return 0
    const parent = byId.get(item.parentId)
    if (!parent) return 0
    seen.add(item.id)
    return Math.min(8, depth(parent, seen) + 1)
  }
  for (const item of items) item.depth = depth(item)
  return items
}

export function orderPortableHierarchy(
  items: PortableCollectionItem[],
  compare: (left: PortableCollectionItem, right: PortableCollectionItem) => number,
): PortableCollectionItem[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const children = new Map<string, PortableCollectionItem[]>()
  const roots: PortableCollectionItem[] = []
  for (const item of items) {
    if (item.parentId && item.parentId !== item.id && byId.has(item.parentId)) {
      children.set(item.parentId, [...(children.get(item.parentId) || []), item])
    } else {
      roots.push(item)
    }
  }
  const ordered: PortableCollectionItem[] = []
  const visited = new Set<string>()
  const visit = (item: PortableCollectionItem, depth: number) => {
    if (visited.has(item.id)) return
    visited.add(item.id)
    ordered.push({ ...item, depth })
    for (const child of [...(children.get(item.id) || [])].sort(compare)) visit(child, depth + 1)
  }
  for (const root of roots.sort(compare)) visit(root, 0)
  for (const item of [...items].sort(compare)) visit(item, 0)
  return ordered
}

export function portableHierarchyLanes(items: PortableCollectionItem[]): PortableHierarchyLane[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const rootFor = (item: PortableCollectionItem) => {
    let current = item
    const seen = new Set<string>()
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
      seen.add(current.id)
      current = byId.get(current.parentId)!
    }
    return current
  }
  const lanes = new Map<string, PortableHierarchyLane>()
  for (const item of items) {
    const root = rootFor(item)
    const lane = lanes.get(root.id) || { id: root.id, root, items: [] }
    lane.items.push(item)
    lanes.set(root.id, lane)
  }
  return [...lanes.values()]
}

export function orderPortableGroups(
  available: string[],
  providerOrder: string[] = [],
  preferredOrder: string[] = [],
  hidden: string[] = [],
): string[] {
  const availableNames = [...new Set(available)]
  const availableSet = new Set(availableNames)
  const baseline = [
    ...providerOrder.filter((name) => availableSet.has(name)),
    ...availableNames.filter((name) => !providerOrder.includes(name)),
  ]
  const preferred = preferredOrder.filter((name) => availableSet.has(name))
  const ordered = [...new Set([...preferred, ...baseline])]
  const hiddenSet = new Set(hidden.filter((name) => availableSet.has(name)))
  const visible = ordered.filter((name) => !hiddenSet.has(name))
  return visible.length ? visible : ordered
}

function portableFieldValue(item: PortableCollectionItem, fieldName: string) {
  const field = item.fields.find((candidate) => candidate.name.toLowerCase() === fieldName.toLowerCase())
  if (!field) return ''
  return field.relations.length ? field.relations.map((relation) => relation.title).join(', ') : field.value
}

export function projectPortableSwimlanes(
  items: PortableCollectionItem[],
  option: PortableSwimlaneOption,
  nested: boolean,
): PortableSwimlane[] {
  if (option.kind === 'none') return []
  if (option.kind === 'field') {
    const lanes = new Map<string, PortableSwimlane>()
    for (const item of items) {
      const label = portableFieldValue(item, option.field || '') || 'Unassigned'
      const lane = lanes.get(label) || {
        id: `field:${option.id}:${label}`,
        label,
        items: [],
        depth: 0,
      }
      lane.items.push(item)
      lanes.set(label, lane)
    }
    return [...lanes.values()].sort((left, right) => left.label.localeCompare(right.label))
  }

  const byId = new Map(items.map((item) => [item.id, item]))
  const matches = (item: PortableCollectionItem, values: string[] | undefined) =>
    Boolean(values?.some((value) => value.toLowerCase() === portableFieldValue(item, option.field || '').toLowerCase()))
  const nearestAncestor = (item: PortableCollectionItem, predicate: (candidate: PortableCollectionItem) => boolean) => {
    let current: PortableCollectionItem | undefined = item
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      if (predicate(current)) return current
      seen.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return undefined
  }
  const topAnchors = items.filter(
    (item) =>
      matches(item, option.anchorValues) &&
      !nearestAncestor(
        item.parentId ? byId.get(item.parentId) || item : item,
        (candidate) => candidate.id !== item.id && matches(candidate, option.anchorValues),
      ),
  )
  const topAnchorIds = new Set(topAnchors.map((item) => item.id))
  const topFor = (item: PortableCollectionItem) => nearestAncestor(item, (candidate) => topAnchorIds.has(candidate.id))
  const nestedAnchors =
    nested && option.nestedAnchorValues?.length
      ? items.filter((item) => matches(item, option.nestedAnchorValues) && Boolean(topFor(item)))
      : []
  const nestedAnchorIds = new Set(nestedAnchors.map((item) => item.id))
  const nestedFor = (item: PortableCollectionItem) => nearestAncestor(item, (candidate) => nestedAnchorIds.has(candidate.id))
  const lanes: PortableSwimlane[] = []

  for (const anchor of topAnchors) {
    const childLanes = nestedAnchors.filter((candidate) => topFor(candidate)?.id === anchor.id)
    const childIds = new Set(childLanes.map((candidate) => candidate.id))
    const groupedChildren =
      nested && option.nestedLabel ? items.filter((item) => item.id !== anchor.id && topFor(item)?.id === anchor.id) : []
    const directItems = groupedChildren.length
      ? [anchor]
      : items.filter((item) => {
          if (topFor(item)?.id !== anchor.id) return false
          const child = nestedFor(item)
          return !child || !childIds.has(child.id)
        })
    lanes.push({
      id: `hierarchy:${option.id}:${anchor.id}`,
      label: anchor.title,
      items: directItems,
      anchor,
      depth: 0,
    })
    if (groupedChildren.length) {
      lanes.push({
        id: `hierarchy:${option.id}:${anchor.id}:children`,
        label: option.nestedLabel!,
        items: groupedChildren,
        depth: 1,
        parentId: `hierarchy:${option.id}:${anchor.id}`,
      })
      continue
    }
    for (const child of childLanes) {
      lanes.push({
        id: `hierarchy:${option.id}:${anchor.id}:${child.id}`,
        label: child.title,
        items: items.filter((item) => topFor(item)?.id === anchor.id && nestedFor(item)?.id === child.id),
        anchor: child,
        depth: 1,
        parentId: `hierarchy:${option.id}:${anchor.id}`,
      })
    }
  }

  const unmatched = items.filter((item) => !topFor(item))
  if (unmatched.length)
    lanes.push({
      id: `hierarchy:${option.id}:other`,
      label: 'Other work',
      items: unmatched,
      depth: 0,
    })
  return lanes
}

export function portableActionPath(
  action: PortableItemAction,
  item?: Pick<PortableCollectionItem, 'id'>,
  parameters: Record<string, string> = {},
) {
  return action.path.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const value = name === 'id' ? item?.id : parameters[name]
    if (!value) throw new Error(`Portable action ${action.id} requires ${name}`)
    return encodeURIComponent(value)
  })
}

export function portableActionBody(inputs: PortableActionInput[] = [], values: Record<string, PortableActionValue>) {
  const declared = new Set(inputs.map((input) => input.name))
  const body: Record<string, unknown> = Object.fromEntries(Object.entries(values).filter(([name]) => !declared.has(name)))
  for (const input of inputs) {
    if (!(input.name in values)) continue
    const value = values[input.name]
    if (input.omitWhenEmpty && (value === '' || value === null || (Array.isArray(value) && value.length === 0))) continue
    const path = input.bodyPath?.length ? input.bodyPath : [input.name]
    let target = body
    for (const segment of path.slice(0, -1)) {
      const next = target[segment]
      target =
        next && typeof next === 'object' && !Array.isArray(next)
          ? (next as Record<string, unknown>)
          : ((target[segment] = {}) as Record<string, unknown>)
    }
    target[path.at(-1)!] = value === '' && input.emptyValue === 'null' ? null : value
  }
  return body
}

export type PortableSettingsValues = Record<string, unknown>

function settingsFieldValue(field: PortableSettingsField, source: unknown): unknown {
  const value = readPortablePath(source, field.valuePath || field.name)
  if (field.type === 'object-list') {
    return portableRecords(value).map((item) => portableSettingsValues(item, field.fields || []))
  }
  if (field.type === 'multiselect') {
    return Array.isArray(value)
      ? value.filter((item) => typeof item === 'string' || typeof item === 'number').map(String)
      : field.defaultValue || []
  }
  if (field.type === 'string-list') {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : field.defaultValue || []
  }
  if (field.type === 'boolean') return typeof value === 'boolean' ? value : Boolean(field.defaultValue)
  if (field.type === 'number') return typeof value === 'number' ? value : (field.defaultValue ?? '')
  if (value === null || value === undefined) return field.defaultValue ?? ''
  return value
}

export function portableSettingsValues(
  source: unknown,
  fieldsOrSurface: PortableSettingsField[] | PortableSettingsSurface,
): PortableSettingsValues {
  const fields = Array.isArray(fieldsOrSurface) ? fieldsOrSurface : fieldsOrSurface.fields
  return Object.fromEntries(fields.map((field) => [field.name, settingsFieldValue(field, source)]))
}

function settingsFieldBody(field: PortableSettingsField, value: unknown): unknown {
  if (field.type === 'object-list') {
    return portableRecords(value).map((item) => portableSettingsBody(field.fields || [], item))
  }
  if (field.type === 'string-list' || field.type === 'multiselect') {
    return Array.isArray(value) ? value : []
  }
  if (field.type === 'boolean') return Boolean(value)
  if (field.type === 'number') {
    if (value === '' || value === null || value === undefined) return null
    const number = Number(value)
    return Number.isFinite(number) ? number : value
  }
  return value ?? ''
}

export function portableSettingsBody(
  fields: PortableSettingsField[],
  values: PortableSettingsValues,
  includeFields?: string[],
): Record<string, unknown> {
  const included = includeFields ? new Set(includeFields) : undefined
  return Object.fromEntries(
    fields
      .filter((field) => !included || included.has(field.name))
      .map((field) => [field.name, settingsFieldBody(field, values[field.name])]),
  )
}

export type PortableSettingsOption = { value: string; label: string }

export function portableSettingsOptions(
  field: PortableSettingsField,
  source: unknown,
  actionResults: Record<string, unknown> = {},
): PortableSettingsOption[] {
  if (field.options?.length) return field.options.map((option) => ({ value: String(option.value), label: option.label }))
  const root = field.optionsAction ? actionResults[field.optionsAction] : source
  let records = portableRecords(readPortablePath(root, field.optionsPath))
  if (field.optionsFilterPath && field.optionsFilterInput) {
    const expected = readPortablePath(source, field.optionsFilterInput)
    records = records.filter((record) => readPortablePath(record, field.optionsFilterPath) === expected)
  }
  return records
    .map((record) => ({
      value: portableText(readPortablePath(record, field.optionValuePath)),
      label: portableText(readPortablePath(record, field.optionLabelPath)),
    }))
    .filter((option) => option.value)
}

export function portableSettingsFieldStored(field: PortableSettingsField, source: unknown) {
  return field.storedPath ? Boolean(readPortablePath(source, field.storedPath)) : false
}

function portableSettingsValueMissing(field: PortableSettingsField, value: unknown) {
  if (field.type === 'boolean' || field.type === 'hidden') return false
  if (field.type === 'number') return value === '' || value === null || value === undefined || !Number.isFinite(Number(value))
  if (field.type === 'multiselect' || field.type === 'string-list' || field.type === 'object-list') {
    return !Array.isArray(value) || value.length === 0
  }
  return typeof value !== 'string' || !value.trim()
}

export function portableSettingsValidationErrors(
  fieldsOrSurface: PortableSettingsField[] | PortableSettingsSurface,
  values: PortableSettingsValues,
  source: unknown = {},
): string[] {
  const fields = Array.isArray(fieldsOrSurface) ? fieldsOrSurface : fieldsOrSurface.fields
  const errors: string[] = []
  const validate = (
    definitions: PortableSettingsField[],
    currentValues: PortableSettingsValues,
    currentSource: unknown,
    context: unknown,
  ) => {
    for (const field of definitions) {
      if (field.type === 'hidden') continue
      if (field.visibleWhen) {
        const conditional = readPortablePath(context, field.visibleWhen.input)
        if ('equals' in field.visibleWhen && conditional !== field.visibleWhen.equals) continue
        if ('notEquals' in field.visibleWhen && conditional === field.visibleWhen.notEquals) continue
      }
      const value = currentValues[field.name]
      if (field.required && !portableSettingsFieldStored(field, currentSource) && portableSettingsValueMissing(field, value)) {
        errors.push(`${field.label} is required.`)
        continue
      }
      if (!Array.isArray(value)) continue
      if (field.minItems !== undefined && value.length < field.minItems)
        errors.push(`${field.label} requires at least ${field.minItems} item${field.minItems === 1 ? '' : 's'}.`)
      if (field.maxItems !== undefined && value.length > field.maxItems)
        errors.push(`${field.label} allows at most ${field.maxItems} items.`)
      if (field.type === 'object-list') {
        const sourceRows = portableRecords(readPortablePath(currentSource, field.valuePath || field.name))
        portableRecords(value).forEach((row, index) => {
          validate(field.fields || [], row, sourceRows[index] || {}, {
            ...(context as Record<string, unknown>),
            ...row,
          })
        })
      }
    }
  }
  validate(fields, values, source, { ...(source as Record<string, unknown>), ...values })
  return errors
}

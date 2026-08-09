import type { ExtensionBoardPreferences, UiPreferences, UiPreferencesPatch, WorkViewPreferences } from '@vertexade/platform-contracts'

export const defaultUiPreferences: UiPreferences = {
  focusOrder: [],
  extensionPins: [],
  extensionBoards: {},
  density: 'comfortable',
  work: {},
}

function string(value: unknown, maximum = 200) {
  return typeof value === 'string' && value.length <= maximum ? value : undefined
}

function oneOf<T extends string>(value: unknown, options: readonly T[]) {
  return options.includes(value as T) ? (value as T) : undefined
}

function workPreferences(value: unknown): WorkViewPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  return {
    repository: string(input.repository),
    kind: string(input.kind, 80),
    sort: oneOf(input.sort, [
      'recent',
      'oldest',
      'priority-high',
      'priority-low',
      'created-newest',
      'created-oldest',
      'title-asc',
      'title-desc',
      'status',
    ]),
    attentionOnly: typeof input.attentionOnly === 'boolean' ? input.attentionOnly : undefined,
    showDone: typeof input.showDone === 'boolean' ? input.showDone : undefined,
    mobileState: oneOf(input.mobileState, ['backlog', 'active', 'review', 'deploy', 'done']),
    view: oneOf(input.view, ['board', 'list', 'completed']),
  }
}

function stringList(value: unknown, maximum = 100) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => string(item, maximum)).filter((item): item is string => Boolean(item)))].slice(0, 100)
    : []
}

function extensionBoardPreferences(value: unknown): ExtensionBoardPreferences {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const rawColumns =
    input.columnsByAxis && typeof input.columnsByAxis === 'object' && !Array.isArray(input.columnsByAxis)
      ? (input.columnsByAxis as Record<string, unknown>)
      : {}
  const columnsByAxis = Object.fromEntries(
    Object.entries(rawColumns)
      .slice(0, 50)
      .flatMap(([axis, candidate]) => {
        const safeAxis = string(axis, 100)
        if (!safeAxis || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
        const column = candidate as Record<string, unknown>
        return [[safeAxis, { order: stringList(column.order), hidden: stringList(column.hidden) }]]
      }),
  )
  return {
    swimlaneOption: string(input.swimlaneOption, 100) || 'none',
    nestedSwimlanes: Boolean(input.nestedSwimlanes),
    columnsByAxis,
  }
}

export function normalizeUiPreferences(value: unknown): UiPreferences {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const focusOrder = Array.isArray(input.focusOrder)
    ? [...new Set(input.focusOrder.filter((id): id is number => Number.isInteger(id) && Number(id) > 0))].slice(0, 500)
    : []
  const extensionPins = Array.isArray(input.extensionPins)
    ? [...new Set(input.extensionPins.map((id) => string(id, 100)).filter((id): id is string => Boolean(id)))].slice(0, 50)
    : []
  const rawBoards =
    input.extensionBoards && typeof input.extensionBoards === 'object' && !Array.isArray(input.extensionBoards)
      ? (input.extensionBoards as Record<string, unknown>)
      : {}
  const extensionBoards = Object.fromEntries(
    Object.entries(rawBoards)
      .slice(0, 50)
      .flatMap(([key, board]) => {
        const safeKey = string(key, 200)
        return safeKey ? [[safeKey, extensionBoardPreferences(board)]] : []
      }),
  )
  return {
    focusOrder,
    extensionPins,
    extensionBoards,
    density: input.density === 'compact' ? 'compact' : 'comfortable',
    work: workPreferences(input.work),
  }
}

export function patchUiPreferences(current: UiPreferences, patch: UiPreferencesPatch) {
  return normalizeUiPreferences({
    ...current,
    ...patch,
    work: patch.work ? { ...current.work, ...patch.work } : current.work,
    extensionBoards: patch.extensionBoards ? { ...current.extensionBoards, ...patch.extensionBoards } : current.extensionBoards,
  })
}

import type {
  CapabilityValue,
  ContextualActionCondition,
  ContextualActionContribution,
  ContextualActionPlacement,
  ModuleCatalogEntry,
} from '@vertexade/platform-contracts'

export type ContextualActionEntity = {
  kind: string
  key: string
  data: Record<string, unknown>
}

export type ResolvedContextualAction = ContextualActionContribution & {
  moduleId: string
  moduleName: string
  enabled: boolean
  disabledReason: string | null
  input: Record<string, CapabilityValue>
}

function fieldValue(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    return (value as Record<string, unknown>)[segment]
  }, source)
}

function jsonValue(value: unknown): CapabilityValue {
  if (value === undefined) return null
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return null
  return JSON.parse(serialized) as CapabilityValue
}

function includesValue(collection: CapabilityValue | undefined, value: unknown) {
  return Array.isArray(collection) && collection.some((candidate) => Object.is(candidate, value))
}

export function contextualConditionMatches(condition: ContextualActionCondition, data: Record<string, unknown>) {
  const actual = fieldValue(data, condition.field)
  if (condition.operator === 'exists') return actual !== undefined && actual !== null
  if (condition.operator === 'not_exists') return actual === undefined || actual === null
  if (condition.operator === 'equals') return Object.is(actual, condition.value)
  if (condition.operator === 'not_equals') return !Object.is(actual, condition.value)
  if (condition.operator === 'in') return includesValue(condition.value, actual)
  return !includesValue(condition.value, actual)
}

export function contextualActionInput(action: ContextualActionContribution, entity: ContextualActionEntity) {
  return Object.fromEntries(
    Object.entries(action.inputMapping || {}).map(([input, path]) => [input, jsonValue(fieldValue(entity.data, path))]),
  )
}

export function contextualConfirmationValue(action: ContextualActionContribution, entity: ContextualActionEntity) {
  const field = action.confirmation?.confirmationField
  const value = field ? fieldValue(entity.data, field) : undefined
  return value === undefined || value === null ? '' : String(value)
}

export function contextualActions(
  modules: ModuleCatalogEntry[],
  entity: ContextualActionEntity,
  placement: ContextualActionPlacement,
): ResolvedContextualAction[] {
  return modules.flatMap((module) =>
    (module.ui?.contextualActions || [])
      .filter((action) => action.placements.includes(placement) && action.entityKinds.includes(entity.kind))
      .map((action) => {
        const failed = (action.conditions || []).find((condition) => !contextualConditionMatches(condition, entity.data))
        return {
          ...action,
          moduleId: module.id,
          moduleName: module.name,
          enabled: module.enabled && !failed,
          disabledReason: !module.enabled
            ? `${module.name} is disabled`
            : failed?.disabledReason || (failed ? 'This action is not available for the current state' : null),
          input: contextualActionInput(action, entity),
        }
      }),
  )
}

export function contextualActionIdempotencyKey(action: ResolvedContextualAction, entity: ContextualActionEntity) {
  const revision = ['head_sha', 'updated_at', 'status', 'state']
    .map((field) => fieldValue(entity.data, field))
    .find((value) => value !== undefined && value !== null)
  return `contextual:${action.moduleId}:${action.id}:${entity.kind}:${entity.key}:${String(revision ?? 'current')}`.slice(0, 200)
}

import type {
  AutomationCondition,
  AutomationConditionMode,
  AutomationConditionOperator,
  CapabilityValue,
  TriggerEvent,
} from '@vertexade/platform-contracts'

const operators = new Set<AutomationConditionOperator>([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'exists',
  'not_exists',
])
const unsafeSegments = new Set(['__proto__', 'prototype', 'constructor'])
const fieldPattern = /^(?:id|occurredAt|subject|data|trigger|thread|previous)(?:\.[A-Za-z0-9_-]+)*$/

function hasValue(input: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(input, 'value')
}

function conditionInput(candidate: unknown) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Automation conditions must be objects')
  return candidate as Record<string, unknown>
}

function conditionField(input: Record<string, unknown>) {
  const field = String(input.field || '').trim()
  const unsafe = field.split('.').some((segment) => unsafeSegments.has(segment))
  if (!fieldPattern.test(field) || unsafe)
    throw new Error('Condition fields must start with id, occurredAt, subject, data, trigger, thread, or previous and use dot notation')
  return field
}

function conditionOperator(input: Record<string, unknown>) {
  const operator = String(input.operator || '') as AutomationConditionOperator
  if (!operators.has(operator)) throw new Error(`Unsupported automation condition operator: ${operator || 'empty'}`)
  return operator
}

function conditionValue(input: Record<string, unknown>, operator: AutomationConditionOperator) {
  const optional = operator === 'exists' || operator === 'not_exists'
  if (!optional && !hasValue(input)) throw new Error(`${operator} conditions require a value`)
  if (['in', 'not_in'].includes(operator) && !Array.isArray(input.value)) throw new Error(`${operator} conditions require an array value`)
  return optional ? {} : { value: input.value as CapabilityValue }
}

function normalizeAutomationCondition(candidate: unknown): AutomationCondition {
  const input = conditionInput(candidate)
  const operator = conditionOperator(input)
  return { field: conditionField(input), operator, ...conditionValue(input, operator) }
}

export function normalizeAutomationConditions(value: unknown, maximum = 20): AutomationCondition[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Automation recipes support up to ${maximum} conditions`)
  return value.map(normalizeAutomationCondition)
}

export function normalizeConditionMode(value: unknown): AutomationConditionMode {
  if (value === undefined || value === null || value === '') return 'all'
  if (value !== 'all' && value !== 'any') throw new Error('Condition mode must be all or any')
  return value
}

function valueAtPath(source: unknown, path: string): unknown {
  let current = source
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function same(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function contains(actual: unknown, expected: unknown) {
  if (typeof actual === 'string') return actual.includes(String(expected ?? ''))
  if (Array.isArray(actual)) return actual.some((item) => same(item, expected))
  return false
}

function compareNumbers(actual: unknown, expected: unknown, compare: (left: number, right: number) => boolean) {
  return typeof actual === 'number' && typeof expected === 'number' && compare(actual, expected)
}

type ConditionEvaluator = (actual: unknown, expected: unknown) => boolean

const conditionEvaluators: Record<AutomationConditionOperator, ConditionEvaluator> = {
  equals: same,
  not_equals: (actual, expected) => !same(actual, expected),
  contains,
  not_contains: (actual, expected) => !contains(actual, expected),
  starts_with: (actual, expected) => typeof actual === 'string' && actual.startsWith(String(expected ?? '')),
  ends_with: (actual, expected) => typeof actual === 'string' && actual.endsWith(String(expected ?? '')),
  in: (actual, expected) => Array.isArray(expected) && expected.some((item) => same(actual, item)),
  not_in: (actual, expected) => Array.isArray(expected) && !expected.some((item) => same(actual, item)),
  greater_than: (actual, expected) => compareNumbers(actual, expected, (left, right) => left > right),
  greater_than_or_equal: (actual, expected) => compareNumbers(actual, expected, (left, right) => left >= right),
  less_than: (actual, expected) => compareNumbers(actual, expected, (left, right) => left < right),
  less_than_or_equal: (actual, expected) => compareNumbers(actual, expected, (left, right) => left <= right),
  exists: (actual) => actual !== undefined,
  not_exists: (actual) => actual === undefined,
}

function automationConditionMatches(condition: AutomationCondition, source: unknown) {
  return conditionEvaluators[condition.operator](valueAtPath(source, condition.field), condition.value)
}

export function automationConditionsMatch(
  conditions: AutomationCondition[],
  mode: AutomationConditionMode,
  source: TriggerEvent | Record<string, unknown>,
) {
  if (!conditions.length) return true
  return mode === 'any'
    ? conditions.some((condition) => automationConditionMatches(condition, source))
    : conditions.every((condition) => automationConditionMatches(condition, source))
}

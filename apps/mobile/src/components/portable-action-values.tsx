
import type { PortableActionInput, PortableActionValue } from '@vertexade/platform-contracts'
import { readPortablePath, type PortableCollectionItem } from '@vertexade/platform-contracts/portable'
import type { MobileAgentOptions } from '@/mobile-agent-options'

export type SourceData = Record<string, unknown>
export type AgentOptions = MobileAgentOptions

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []
}

export function defaultValue(input: PortableActionInput): PortableActionValue {
  if (input.defaultValue !== undefined) return input.defaultValue
  if (input.type === 'boolean') return false
  if (input.type === 'multiselect') return []
  return ''
}

export function normalizeActionValue(value: unknown): PortableActionValue {
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(String)
  return String(value ?? '')
}

export function actionValueMissing(value: PortableActionValue | undefined) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

export function actionInputOptions(input: PortableActionInput, data: SourceData, item: PortableCollectionItem | null) {
  if (input.options?.length) return input.options
  return records(readPortablePath(input.optionsSource === 'item' ? item?.raw : data, input.optionsPath))
}

function conditionMatches(input: PortableActionInput, values: Record<string, PortableActionValue>) {
  if (!input.visibleWhen) return true
  const value = values[input.visibleWhen.input]
  if (input.visibleWhen.equals !== undefined) return value === input.visibleWhen.equals
  if (input.visibleWhen.notEquals !== undefined) return value !== input.visibleWhen.notEquals
  return Boolean(value)
}

export function visibleInputs(inputs: PortableActionInput[], values: Record<string, PortableActionValue>) {
  return inputs.filter((input) => conditionMatches(input, values))
}

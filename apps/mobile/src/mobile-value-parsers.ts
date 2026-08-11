export function requiredRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

export function requiredPositiveInteger(value: unknown, label: string): number {
  const result = optionalPositiveInteger(value)
  if (result === null) throw new Error(`${label} is invalid`)
  return result
}

export function optionalPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

export function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

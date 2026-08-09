export type ProviderDataRecord = Record<string, any>

export function providerRecord(value: unknown): ProviderDataRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ProviderDataRecord) : {}
}

export function providerValues(value: unknown) {
  return Array.isArray(value) ? value : []
}

export function firstProviderValue(...candidates: unknown[]) {
  return candidates.find(Boolean)
}

export function providerText(...candidates: unknown[]) {
  return String(firstProviderValue(...candidates) ?? '')
}

export function providerNumber(...candidates: unknown[]) {
  return Number(firstProviderValue(...candidates) ?? 0)
}

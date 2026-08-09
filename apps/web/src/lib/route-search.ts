export function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

export function optionalString(value: unknown, maximum = 200) {
  return typeof value === 'string' && value ? value.slice(0, maximum) : undefined
}

export function optionalEnum<T extends string>(value: unknown, choices: readonly T[]) {
  return choices.includes(value as T) ? (value as T) : undefined
}

export function optionalBoolean(value: unknown) {
  return [true, 'true', '1'].includes(value as true) ? true : undefined
}

export function optionalOne(value: unknown) {
  return [1, '1'].includes(value as 1) ? (1 as const) : undefined
}

export function defaultValue<T>(value: T, fallback: T) {
  return value === fallback ? undefined : value
}

export function mergeDefined<T extends object>(base: T, patch: Partial<T>): T {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  return { ...base, ...defined }
}

export type ApiBackend = {
  id: string
  label: string
  url: string
  namespace: number
  isDefault: boolean
}

export type BackendInput = string | { id?: unknown; label?: unknown; url?: unknown; namespace?: unknown }

const defaultApiUrl = 'http://127.0.0.1:4174'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function backendId(value: unknown, index: number) {
  const candidate = text(value) || `server-${index + 1}`
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(candidate)) {
    throw new Error(`Invalid backend id "${candidate}". Use letters, numbers, dashes, or underscores.`)
  }
  return candidate.toLowerCase()
}

function backendUrl(value: unknown) {
  const candidate = text(value)
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(`Invalid backend URL "${candidate}"`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`Backend URL must be an HTTP(S) origin without embedded credentials: "${candidate}"`)
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '') || '/'
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

function backendLabel(value: unknown, url: string, index: number) {
  return text(value) || (index === 0 ? 'Local' : new URL(url).host || `Server ${index + 1}`)
}

function parsedBackendInputs(value: string): BackendInput[] {
  const trimmed = value.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!Array.isArray(parsed)) throw new Error('VERTEXADE_API_URLS must be a JSON array')
    return parsed as BackendInput[]
  } catch (error) {
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) throw error
    return trimmed.split(',').map((entry) => entry.trim())
  }
}

export function resolveApiBackends(environment: Record<string, string | undefined> = process.env): ApiBackend[] {
  const configured = parsedBackendInputs(environment.VERTEXADE_API_URLS || '')
  const inputs: BackendInput[] = configured.length
    ? configured
    : [environment.VERTEXADE_API_URL || environment.DASHBOARD_API_URL || defaultApiUrl]
  const backends = inputs.map((input, index) => {
    const object = typeof input === 'string' ? { url: input } : input
    const url = backendUrl(object.url)
    const configuredNamespace = Number(object.namespace)
    const namespace = Number.isInteger(configuredNamespace) && configuredNamespace >= 0 ? configuredNamespace : index
    return {
      id: backendId(object.id, index),
      label: backendLabel(object.label, url, index),
      url,
      namespace,
      isDefault: index === 0,
    }
  })
  const duplicate = backends.find((backend, index) => backends.findIndex((candidate) => candidate.id === backend.id) !== index)
  if (duplicate) throw new Error(`Duplicate backend id "${duplicate.id}"`)
  const duplicateNamespace = backends.find(
    (backend, index) => backends.findIndex((candidate) => candidate.namespace === backend.namespace) !== index,
  )
  if (duplicateNamespace) throw new Error(`Duplicate backend namespace "${duplicateNamespace.namespace}"`)
  return backends
}

export function resolveApiBackendInputs(inputs: BackendInput[]) {
  return resolveApiBackends({ VERTEXADE_API_URLS: JSON.stringify(inputs) })
}

export function resolveApiBackend(environment: Record<string, string | undefined> = process.env) {
  return resolveApiBackends(environment)[0].url
}

export const apiBackends = resolveApiBackends()
export const apiBackend = apiBackends[0].url

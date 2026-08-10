import { OutboundRequestPolicy } from '@vertexade/platform-server/outbound-policy'

export type LinkedServer = {
  id: string
  label: string
  url: string
  namespace: number
  enabled: boolean
}

type VerifyRequest = (input: string | URL, init?: RequestInit) => Promise<Response>

type SettingsStore = {
  read<T>(key: string, fallback: T): T
  write(key: string, value: unknown): void
}

const settingsKey = 'linked_servers'

function origin(value: unknown) {
  const candidate = String(value || '').trim()
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('Server URL must be a valid HTTP(S) origin')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Server URL must be an HTTP(S) origin without credentials, query, or fragment')
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  return parsed.toString().replace(/\/$/, '')
}

function id(value: unknown) {
  const candidate = String(value || '')
    .trim()
    .toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(candidate)) throw new Error('Server id must use 1–48 letters, numbers, dashes, or underscores')
  return candidate
}

export function normalizeLinkedServer(value: unknown): LinkedServer {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const url = origin(input.url)
  const serverId = id(input.id)
  const label = String(input.label || '')
    .trim()
    .slice(0, 80)
  if (!label) throw new Error('Server label is required')
  const namespace = Number(input.namespace)
  return {
    id: serverId,
    label,
    url,
    namespace: Number.isInteger(namespace) && namespace > 0 ? namespace : 0,
    enabled: input.enabled !== false,
  }
}

export async function verifyLinkedServer(url: string, request: VerifyRequest) {
  const response = await request(new URL('/api/read-model/status', `${url}/`), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`Server verification failed with HTTP ${response.status}`)
  const raw = await response.text()
  if (raw.length > 64 * 1024) throw new Error('Server verification response is too large')
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('Server verification did not return JSON')
  }
  if (typeof payload.instanceId !== 'string' || typeof payload.version !== 'number') {
    throw new Error('Origin is not a compatible VertexADE server')
  }
  return { instanceId: payload.instanceId, version: payload.version }
}

export async function verifyApprovedLinkedServer(url: string) {
  const policy = new OutboundRequestPolicy({
    allowedOrigins: [new URL(url).origin],
  })
  try {
    return await verifyLinkedServer(url, policy.fetch)
  } finally {
    await policy.dispose()
  }
}

export function readLinkedServers(store: SettingsStore) {
  const stored = store.read<unknown[]>(settingsKey, [])
  if (!Array.isArray(stored)) return []
  return stored.flatMap((value, index) => {
    try {
      const server = normalizeLinkedServer(value)
      return [{ ...server, namespace: server.namespace || index + 1 }]
    } catch {
      return []
    }
  })
}

export function writeLinkedServers(store: SettingsStore, servers: LinkedServer[]) {
  store.write(settingsKey, servers)
}

import type { MobilePairingRedemption } from '@vertexade/platform-contracts'

export type BrowserPairedServer = Omit<MobilePairingRedemption, 'sessionToken'> & {
  id: string
  name: string
  namespace: number
  credentialId?: string
  sessionToken?: string
}

const browserPairingStorageKey = 'vertexade.web.paired-servers.v1'
export const browserPairingHeader = 'x-vertexade-paired-servers'
const pairTokenPattern = /^[A-Z0-9]{32}$/

function origin(value: string) {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('Pairing origin must be HTTP(S)')
  return parsed.origin
}

export function parseBrowserPairLink(value: string) {
  const parsed = new URL(value.trim())
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''))
  const token = String(fragment.get('token') || '')
    .trim()
    .toUpperCase()
  if (!pairTokenPattern.test(token)) throw new Error('Pair link has an invalid one-time token')
  if (['http:', 'https:'].includes(parsed.protocol) && parsed.pathname === '/pair' && !parsed.search) {
    return { serviceUrl: parsed.origin, token }
  }
  if (parsed.protocol === 'vertexade:' && parsed.hostname === 'pair') {
    return { serviceUrl: origin(String(fragment.get('origin') || '')), token }
  }
  throw new Error('Use a VertexADE pairing link')
}

function validServer(value: unknown): BrowserPairedServer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const server = value as Partial<BrowserPairedServer>
  try {
    const serviceUrl = origin(String(server.serviceUrl || ''))
    const expiresAt = String(server.expiresAt || '')
    const sessionToken = String(server.sessionToken || '').trim()
    const credentialId = String(server.credentialId || '').trim()
    const namespace = Number(server.namespace)
    const id = String(server.id || '')
      .trim()
      .toLowerCase()
    if ((!sessionToken && !credentialId) || Date.parse(expiresAt) <= Date.now() || !Number.isSafeInteger(namespace) || namespace < 1)
      return null
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id)) return null
    return {
      id,
      name: String(server.name || '').trim() || new URL(serviceUrl).host,
      namespace,
      serviceUrl,
      ...(credentialId ? { credentialId } : {}),
      ...(sessionToken ? { sessionToken } : {}),
      expiresAt,
    }
  } catch {
    return null
  }
}

export function readBrowserPairedServers(storage: Pick<Storage, 'getItem'> = localStorage): BrowserPairedServer[] {
  try {
    const parsed = JSON.parse(storage.getItem(browserPairingStorageKey) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    const unique = new Map<string, BrowserPairedServer>()
    for (const value of parsed) {
      const server = validServer(value)
      if (server) unique.set(server.serviceUrl, server)
    }
    return [...unique.values()]
  } catch {
    return []
  }
}

export function writeBrowserPairedServers(servers: BrowserPairedServer[], storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(browserPairingStorageKey, JSON.stringify(servers))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('vertexade:paired-servers'))
}

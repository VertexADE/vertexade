import * as SecureStore from 'expo-secure-store'
import { normalizePlatformBaseUrl } from '@vertexade/platform-client'

export type MobileSession = {
  serviceUrl: string
  sessionToken: string
  expiresAt: string
  name?: string
}

export type MobileSessionCatalog = {
  activeServiceUrl: string
  sessions: MobileSession[]
}

const mobileSessionCatalogKey = 'vertexade.mobile.sessions.v2'
const legacyMobileSessionKey = 'vertexade.mobile.session.v1'
let cachedCatalog: MobileSessionCatalog | undefined

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function optionalName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim() || undefined
}

function parseMobileSession(value: unknown): MobileSession | null {
  if (!record(value)) return null
  const serviceUrl = typeof value.serviceUrl === 'string' ? normalizePlatformBaseUrl(value.serviceUrl) : ''
  const sessionToken = typeof value.sessionToken === 'string' ? value.sessionToken.trim() : ''
  const expiresAt = typeof value.expiresAt === 'string' ? value.expiresAt : ''
  const name = optionalName(value.name)
  if (!serviceUrl || !sessionToken || !Number.isFinite(Date.parse(expiresAt))) return null
  return { serviceUrl, sessionToken, expiresAt, ...(name ? { name } : {}) }
}

function validSessions(value: unknown): MobileSession[] {
  if (!Array.isArray(value)) return []
  const unique = new Map<string, MobileSession>()
  for (const candidate of value) {
    const session = parseMobileSession(candidate)
    if (session && Date.parse(session.expiresAt) > Date.now()) unique.set(session.serviceUrl, session)
  }
  return [...unique.values()]
}

function parseCatalog(value: unknown): MobileSessionCatalog {
  if (!record(value)) return { activeServiceUrl: '', sessions: [] }
  const sessions = validSessions(value.sessions)
  const requestedActive = typeof value.activeServiceUrl === 'string' ? normalizePlatformBaseUrl(value.activeServiceUrl) : ''
  return {
    activeServiceUrl: sessions.some((session) => session.serviceUrl === requestedActive)
      ? requestedActive
      : sessions[0]?.serviceUrl || '',
    sessions,
  }
}

async function storedJson(key: string): Promise<unknown> {
  const raw = await SecureStore.getItemAsync(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

async function persistCatalog(catalog: MobileSessionCatalog): Promise<void> {
  cachedCatalog = catalog
  await SecureStore.setItemAsync(mobileSessionCatalogKey, JSON.stringify(catalog), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  })
}

export async function readMobileSessionCatalog(): Promise<MobileSessionCatalog> {
  if (cachedCatalog) return cachedCatalog
  const stored = await storedJson(mobileSessionCatalogKey)
  const catalog = parseCatalog(stored)
  if (catalog.sessions.length) {
    cachedCatalog = catalog
    return catalog
  }

  const legacy = parseMobileSession(await storedJson(legacyMobileSessionKey))
  if (legacy && Date.parse(legacy.expiresAt) > Date.now()) {
    const migrated = { activeServiceUrl: legacy.serviceUrl, sessions: [legacy] }
    await persistCatalog(migrated)
    await SecureStore.deleteItemAsync(legacyMobileSessionKey)
    return migrated
  }
  cachedCatalog = { activeServiceUrl: '', sessions: [] }
  return cachedCatalog
}

export async function saveMobileSession(session: MobileSession): Promise<void> {
  const parsed = parseMobileSession(session)
  if (!parsed || Date.parse(parsed.expiresAt) <= Date.now()) throw new Error('VertexADE returned an invalid or expired mobile session')
  const catalog = await readMobileSessionCatalog()
  const existing = catalog.sessions.find((candidate) => candidate.serviceUrl === parsed.serviceUrl)
  const saved = parsed.name || !existing?.name ? parsed : { ...parsed, name: existing.name }
  await persistCatalog({
    activeServiceUrl: saved.serviceUrl,
    sessions: [...catalog.sessions.filter((candidate) => candidate.serviceUrl !== saved.serviceUrl), saved],
  })
}

export async function selectMobileSession(serviceUrl: string): Promise<void> {
  const normalized = normalizePlatformBaseUrl(serviceUrl)
  const catalog = await readMobileSessionCatalog()
  if (!catalog.sessions.some((session) => session.serviceUrl === normalized)) throw new Error('VertexADE server is not paired on this device')
  await persistCatalog({ ...catalog, activeServiceUrl: normalized })
}

export async function renameMobileSession(serviceUrl: string, name: string): Promise<void> {
  const normalized = normalizePlatformBaseUrl(serviceUrl)
  const catalog = await readMobileSessionCatalog()
  if (!catalog.sessions.some((session) => session.serviceUrl === normalized)) throw new Error('VertexADE server is not paired on this device')
  const trimmedName = name.trim()
  await persistCatalog({
    ...catalog,
    sessions: catalog.sessions.map((session) => session.serviceUrl === normalized
      ? { ...session, ...(trimmedName ? { name: trimmedName } : { name: undefined }) }
      : session),
  })
}

export async function mobileAccessToken(serviceUrl: string): Promise<string | null> {
  const normalized = normalizePlatformBaseUrl(serviceUrl)
  const catalog = await readMobileSessionCatalog()
  return catalog.sessions.find((session) => session.serviceUrl === normalized)?.sessionToken || null
}

export function resetMobileSessionCacheForTests(): void {
  cachedCatalog = undefined
}

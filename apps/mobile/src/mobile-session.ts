import * as SecureStore from 'expo-secure-store'
import { normalizePlatformBaseUrl } from '@vertexade/platform-client'

export type MobileSession = {
  serviceUrl: string
  sessionToken: string
  expiresAt: string
}

const mobileSessionKey = 'vertexade.mobile.session.v1'
let cachedSession: MobileSession | null | undefined

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseMobileSession(value: unknown): MobileSession | null {
  if (!record(value)) return null
  const serviceUrl = typeof value.serviceUrl === 'string' ? normalizePlatformBaseUrl(value.serviceUrl) : ''
  const sessionToken = typeof value.sessionToken === 'string' ? value.sessionToken.trim() : ''
  const expiresAt = typeof value.expiresAt === 'string' ? value.expiresAt : ''
  if (!serviceUrl || !sessionToken || !Number.isFinite(Date.parse(expiresAt))) return null
  return { serviceUrl, sessionToken, expiresAt }
}

export async function readMobileSession(): Promise<MobileSession | null> {
  if (cachedSession !== undefined) return cachedSession
  const raw = await SecureStore.getItemAsync(mobileSessionKey)
  let parsed: MobileSession | null = null
  try {
    parsed = raw ? parseMobileSession(JSON.parse(raw) as unknown) : null
  } catch {
    parsed = null
  }
  if (parsed && Date.parse(parsed.expiresAt) > Date.now()) {
    cachedSession = parsed
    return parsed
  }
  cachedSession = null
  if (raw) await SecureStore.deleteItemAsync(mobileSessionKey)
  return null
}

export async function saveMobileSession(session: MobileSession): Promise<void> {
  const parsed = parseMobileSession(session)
  if (!parsed || Date.parse(parsed.expiresAt) <= Date.now()) throw new Error('VertexADE returned an invalid or expired mobile session')
  await SecureStore.setItemAsync(mobileSessionKey, JSON.stringify(parsed), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  })
  cachedSession = parsed
}

export async function mobileAccessToken(serviceUrl: string): Promise<string | null> {
  const session = await readMobileSession()
  return session?.serviceUrl === normalizePlatformBaseUrl(serviceUrl) ? session.sessionToken : null
}

export function resetMobileSessionCacheForTests(): void {
  cachedSession = undefined
}

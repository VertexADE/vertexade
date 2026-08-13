import type { MobilePairingRedemption } from '@vertexade/platform-contracts'
import { normalizePlatformBaseUrl } from '@vertexade/platform-client'
import { saveMobileSession, type MobileSession } from './mobile-session'

export type MobilePairingDetails = {
  serviceUrl: string
  token: string
}

const pairingTokenPattern = /^[A-Z0-9]{32}$/

function pairingOrigin(value: string): string {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Pairing origin must be an HTTP(S) service address')
  }
  return parsed.origin
}

export function parseMobilePairLink(value: string): MobilePairingDetails {
  const parsed = new URL(value.trim())
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''))
  const token = String(fragment.get('token') || '').trim().toUpperCase()
  if (!pairingTokenPattern.test(token)) throw new Error('Pair link has an invalid one-time token')

  if (['http:', 'https:'].includes(parsed.protocol)) {
    if (parsed.username || parsed.password || parsed.pathname !== '/pair' || parsed.search) throw new Error('Pair link is invalid')
    return { serviceUrl: parsed.origin, token }
  }
  if (parsed.protocol === 'vertexade:' && parsed.hostname === 'pair') {
    return { serviceUrl: pairingOrigin(String(fragment.get('origin') || '')), token }
  }
  throw new Error('Pair link must open VertexADE Mobile or an HTTP(S) /pair page')
}

function redemptionRecord(value: unknown): Partial<MobilePairingRedemption> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VertexADE returned an invalid pairing response')
  return value as Partial<MobilePairingRedemption>
}

function responseString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function validRedemption(serviceUrl: string, sessionToken: string, expiresAt: string, expectedOrigin: string): boolean {
  return serviceUrl === expectedOrigin && Boolean(sessionToken) && Number.isFinite(Date.parse(expiresAt))
}

function parseRedemption(value: unknown, expectedOrigin: string): MobilePairingRedemption {
  const response = redemptionRecord(value)
  const rawServiceUrl = responseString(response.serviceUrl)
  const serviceUrl = rawServiceUrl ? normalizePlatformBaseUrl(rawServiceUrl) : ''
  const sessionToken = responseString(response.sessionToken)
  const expiresAt = responseString(response.expiresAt)
  if (!validRedemption(serviceUrl, sessionToken, expiresAt, expectedOrigin)) throw new Error('VertexADE returned an invalid pairing response')
  return { serviceUrl, sessionToken, expiresAt }
}

function errorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const error = (value as Record<string, unknown>).error
  return typeof error === 'string' && error.trim() ? error : null
}

export async function redeemMobilePairLink(value: string, deviceName = 'VertexADE Mobile', connectionName = ''): Promise<MobileSession> {
  const pairing = parseMobilePairLink(value)
  const response = await fetch(`${pairing.serviceUrl}/api/mobile-pairing/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: pairing.token, deviceName }),
  })
  const payload = (await response.json().catch(() => null)) as unknown
  if (!response.ok) {
    throw new Error(errorMessage(payload) || `HTTP ${response.status}`)
  }
  const redeemed = parseRedemption(payload, pairing.serviceUrl)
  const name = connectionName.trim()
  const session = { ...redeemed, ...(name ? { name } : {}) }
  await saveMobileSession(session)
  return session
}

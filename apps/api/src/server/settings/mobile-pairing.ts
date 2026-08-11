import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type {
  MobilePairingDevice,
  MobilePairingInvitation,
  MobilePairingRedemption,
  MobilePairingStatus,
} from '@vertexade/platform-contracts'

type SecureSettingsStore = {
  read<T>(name: string, fallback: T): T
  write(name: string, value: unknown): void
}

type StoredInvitation = {
  digest: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
}

type StoredMobileSession = MobilePairingDevice & {
  digest: string
  revokedAt: string | null
}

type MobilePairingState = {
  version: 1
  publicOrigin: string
  invitations: StoredInvitation[]
  sessions: StoredMobileSession[]
}

type MobilePairingServiceOptions = {
  now?: () => Date
  randomToken?: () => string
  randomSessionSecret?: () => string
  randomSessionId?: () => string
}

const settingsKey = 'mobile_pairing'
const invitationLifetimeMs = 10 * 60 * 1_000
const sessionLifetimeMs = 90 * 24 * 60 * 60 * 1_000
const lastUsedWriteIntervalMs = 5 * 60 * 1_000
const maxStoredInvitations = 8
const maxStoredSessions = 64
const tokenPattern = /^[A-Z0-9]{32}$/
const sessionIdPattern = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i

const base32Alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export class MobilePairingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'invalid_origin' | 'invalid_token' | 'expired_token' | 'used_token' | 'invalid_session' | 'unknown_device',
  ) {
    super(message)
    this.name = 'MobilePairingError'
  }
}

function base32(value: Buffer): string {
  let bits = 0
  let accumulator = 0
  let output = ''
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += base32Alphabet[(accumulator >>> bits) & 31]
    }
  }
  if (bits) output += base32Alphabet[(accumulator << (5 - bits)) & 31]
  return output
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function digestText(value: string): string {
  return digest(value).toString('base64url')
}

function secureDigestMatch(value: string, expected: string): boolean {
  let expectedDigest: Buffer
  try {
    expectedDigest = Buffer.from(expected, 'base64url')
  } catch {
    return false
  }
  const actualDigest = digest(value)
  return expectedDigest.byteLength === actualDigest.byteLength && timingSafeEqual(expectedDigest, actualDigest)
}

function publicOrigin(value: unknown): string {
  let parsed: URL
  try {
    parsed = new URL(String(value || '').trim())
  } catch {
    throw new MobilePairingError('Share address must be a valid HTTP(S) origin', 400, 'invalid_origin')
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new MobilePairingError(
      'Share address must be an HTTP(S) origin without credentials, a path, query, or fragment',
      400,
      'invalid_origin',
    )
  }
  return parsed.origin
}

function deviceName(value: unknown): string {
  return (
    String(value || 'VertexADE Mobile')
      .trim()
      .slice(0, 80) || 'VertexADE Mobile'
  )
}

function emptyState(): MobilePairingState {
  return { version: 1, publicOrigin: '', invitations: [], sessions: [] }
}

function validState(value: unknown): value is MobilePairingState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<MobilePairingState>
  return (
    state.version === 1 &&
    typeof state.publicOrigin === 'string' &&
    Array.isArray(state.invitations) &&
    state.invitations.every(validInvitation) &&
    Array.isArray(state.sessions) &&
    state.sessions.every(validSession)
  )
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z\d_-]{43}$/.test(value)
}

function validInvitation(value: unknown): value is StoredInvitation {
  if (!value || typeof value !== 'object') return false
  const invitation = value as Partial<StoredInvitation>
  return (
    validDigest(invitation.digest) &&
    validDate(invitation.createdAt) &&
    validDate(invitation.expiresAt) &&
    (invitation.usedAt === null || validDate(invitation.usedAt))
  )
}

function validSessionIdentity(session: Partial<StoredMobileSession>): boolean {
  return typeof session.id === 'string' && sessionIdPattern.test(session.id) && typeof session.name === 'string'
}

function validSessionDates(session: Partial<StoredMobileSession>): boolean {
  const validRevocation = session.revokedAt === null || validDate(session.revokedAt)
  return validDate(session.createdAt) && validDate(session.lastUsedAt) && validDate(session.expiresAt) && validRevocation
}

function validSession(value: unknown): value is StoredMobileSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<StoredMobileSession>
  return validSessionIdentity(session) && validDigest(session.digest) && validSessionDates(session)
}

function publicDevice(session: StoredMobileSession): MobilePairingDevice {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
  }
}

function bearerToken(authorization: string | null): string {
  const value = String(authorization || '')
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}

export class MobilePairingService {
  readonly #now: () => Date
  readonly #randomToken: () => string
  readonly #randomSessionSecret: () => string
  readonly #randomSessionId: () => string

  constructor(
    private readonly settings: SecureSettingsStore,
    options: MobilePairingServiceOptions = {},
  ) {
    this.#now = options.now || (() => new Date())
    this.#randomToken = options.randomToken || (() => base32(randomBytes(20)))
    this.#randomSessionSecret = options.randomSessionSecret || (() => randomBytes(32).toString('base64url'))
    this.#randomSessionId = options.randomSessionId || randomUUID
  }

  status(): MobilePairingStatus {
    const state = this.#readPruned()
    const activeInvitation = state.invitations.find((invitation) => !invitation.usedAt) || null
    return {
      publicOrigin: state.publicOrigin,
      invitationExpiresAt: activeInvitation?.expiresAt || null,
      devices: state.sessions.filter((session) => !session.revokedAt).map(publicDevice),
    }
  }

  createInvitation(value: unknown): MobilePairingInvitation {
    const origin = publicOrigin(value)
    const token = this.#randomToken()
    if (!tokenPattern.test(token)) throw new Error('Pairing token generator returned an invalid token')
    const now = this.#now()
    const state = this.#readPruned(now)
    const invitation: StoredInvitation = {
      digest: digestText(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + invitationLifetimeMs).toISOString(),
      usedAt: null,
    }
    state.publicOrigin = origin
    state.invitations = [invitation, ...state.invitations].slice(0, maxStoredInvitations)
    this.#write(state)
    return {
      pairUrl: `${origin}/pair#token=${token}`,
      expiresAt: invitation.expiresAt,
    }
  }

  redeem(tokenValue: unknown, nameValue: unknown): MobilePairingRedemption {
    const token = String(tokenValue || '')
      .trim()
      .toUpperCase()
    if (!tokenPattern.test(token)) throw new MobilePairingError('Pairing link is invalid', 401, 'invalid_token')
    const now = this.#now()
    const state = this.#read()
    const invitation = state.invitations.find((candidate) => secureDigestMatch(token, candidate.digest))
    if (!invitation) throw new MobilePairingError('Pairing link is invalid', 401, 'invalid_token')
    if (invitation.usedAt) throw new MobilePairingError('Pairing link has already been used', 409, 'used_token')
    if (Date.parse(invitation.expiresAt) <= now.getTime()) throw new MobilePairingError('Pairing link has expired', 410, 'expired_token')

    const id = this.#randomSessionId()
    const secret = this.#randomSessionSecret()
    const sessionToken = `${id}.${secret}`
    const timestamp = now.toISOString()
    const session: StoredMobileSession = {
      id,
      name: deviceName(nameValue),
      digest: digestText(sessionToken),
      createdAt: timestamp,
      lastUsedAt: timestamp,
      expiresAt: new Date(now.getTime() + sessionLifetimeMs).toISOString(),
      revokedAt: null,
    }
    invitation.usedAt = timestamp
    state.sessions = [session, ...state.sessions].slice(0, maxStoredSessions)
    this.#write(state)
    return { serviceUrl: state.publicOrigin, sessionToken, expiresAt: session.expiresAt }
  }

  validate(authorization: string | null): MobilePairingDevice {
    const token = bearerToken(authorization)
    const separator = token.indexOf('.')
    const id = separator > 0 ? token.slice(0, separator) : ''
    if (!sessionIdPattern.test(id)) throw new MobilePairingError('Mobile session is invalid', 401, 'invalid_session')
    const state = this.#read()
    const session = state.sessions.find((candidate) => candidate.id === id)
    const now = this.#now()
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= now.getTime() || !secureDigestMatch(token, session.digest)) {
      throw new MobilePairingError('Mobile session is invalid', 401, 'invalid_session')
    }
    if (now.getTime() - Date.parse(session.lastUsedAt) >= lastUsedWriteIntervalMs) {
      session.lastUsedAt = now.toISOString()
      this.#write(state)
    }
    return publicDevice(session)
  }

  revoke(idValue: unknown): MobilePairingStatus {
    const id = String(idValue || '')
    const state = this.#read()
    const session = state.sessions.find((candidate) => candidate.id === id && !candidate.revokedAt)
    if (!session) throw new MobilePairingError('Paired device was not found', 404, 'unknown_device')
    session.revokedAt = this.#now().toISOString()
    this.#write(state)
    return this.status()
  }

  #read(): MobilePairingState {
    const value = this.settings.read<unknown>(settingsKey, emptyState())
    return validState(value) ? value : emptyState()
  }

  #readPruned(now = this.#now()): MobilePairingState {
    const state = this.#read()
    const invitations = state.invitations.filter((invitation) => invitation.usedAt || Date.parse(invitation.expiresAt) > now.getTime())
    const sessions = state.sessions.filter((session) => !session.revokedAt && Date.parse(session.expiresAt) > now.getTime())
    if (invitations.length !== state.invitations.length || sessions.length !== state.sessions.length) {
      state.invitations = invitations
      state.sessions = sessions
      this.#write(state)
    }
    return state
  }

  #write(state: MobilePairingState): void {
    this.settings.write(settingsKey, state)
  }
}

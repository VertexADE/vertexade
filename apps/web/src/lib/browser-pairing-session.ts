import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

const browserCredentialCookiePrefix = 'vertexade_pair_'
const browserSessionCookie = 'vertexade_browser_session'

function cookieValue(request: Request, name: string) {
  return (
    (request.headers.get('cookie') || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ''
  )
}

function decodedToken(value: string) {
  if (!value) return ''
  try {
    return Buffer.from(decodeURIComponent(value), 'base64url').toString('utf8').trim()
  } catch {
    return ''
  }
}

export function browserSessionAuthorization(request: Request) {
  const token = decodedToken(cookieValue(request, browserSessionCookie))
  return token ? `Bearer ${token}` : ''
}

export function browserCredential(request: Request, credentialId: string | undefined) {
  return credentialId ? decodedToken(cookieValue(request, `${browserCredentialCookiePrefix}${credentialId}`)) : ''
}

export function browserCredentialId(serviceUrl: string) {
  return createHash('sha256').update(serviceUrl).digest('hex').slice(0, 24)
}

function secureCookieAttribute(request: Request) {
  return new URL(request.url).protocol === 'https:' ? '; Secure' : ''
}

function encodedToken(token: string) {
  return encodeURIComponent(Buffer.from(token).toString('base64url'))
}

export function browserCredentialCookie(request: Request, credentialId: string, token: string, expiresAt: string) {
  return `${browserCredentialCookiePrefix}${credentialId}=${encodedToken(token)}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict${secureCookieAttribute(request)}`
}

export function clearBrowserCredentialCookie(request: Request, credentialId: string) {
  return `${browserCredentialCookiePrefix}${credentialId}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secureCookieAttribute(request)}`
}

export function localBrowserSessionCookie(request: Request, token: string) {
  return `${browserSessionCookie}=${encodedToken(token)}; Path=/; HttpOnly; SameSite=Strict${secureCookieAttribute(request)}`
}

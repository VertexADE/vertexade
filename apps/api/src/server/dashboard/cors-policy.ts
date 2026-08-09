import { commaSeparatedValues } from '@vertexade/platform-server/configuration'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const
const HEADERS = [
  'authorization',
  'content-type',
  'x-agent-provider',
  'x-agent-model',
  'x-agent-reasoning-effort',
  'x-agent-service-tier',
  'x-agent-ephemeral',
  'x-agent-subagents',
] as const
const methodSet = new Set<string>(METHODS)
const headerSet = new Set<string>(HEADERS)

export class CorsConfigurationError extends Error {}

function normalizedOrigin(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CorsConfigurationError('CORS origins must be valid absolute URLs')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new CorsConfigurationError('CORS origins must use HTTP or HTTPS')
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new CorsConfigurationError('CORS origins must not contain credentials, a path, query, or fragment')
  return url.origin
}

export function parseCorsAllowedOrigins(value: string | undefined) {
  const origins = new Set<string>()
  for (const entry of commaSeparatedValues(value)) {
    if (entry === '*' || entry === 'null' || entry.includes('*'))
      throw new CorsConfigurationError('CORS origins must be explicit and must not contain wildcards')
    origins.add(normalizedOrigin(entry))
  }
  return origins
}

function origin(request: Request) {
  const value = request.headers.get('origin')
  if (!value) return null
  try {
    return normalizedOrigin(value)
  } catch {
    return ''
  }
}

function requestedHeaders(request: Request) {
  return String(request.headers.get('access-control-request-headers') || '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean)
}

function mergeVary(headers: Headers, name: string) {
  const values = String(headers.get('vary') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (!values.some((value) => value.toLowerCase() === name.toLowerCase())) values.push(name)
  headers.set('vary', values.join(', '))
}

export class DashboardCorsPolicy {
  readonly allowedOrigins: ReadonlySet<string>

  constructor(allowedOrigins: Iterable<string> = []) {
    this.allowedOrigins = new Set(allowedOrigins)
  }

  #headers(requestOrigin: string) {
    const headers = new Headers({ 'access-control-allow-origin': requestOrigin })
    mergeVary(headers, 'Origin')
    return headers
  }

  #error(status: number, message: string, requestOrigin?: string) {
    const headers = requestOrigin ? this.#headers(requestOrigin) : new Headers()
    headers.set('content-type', 'application/json; charset=utf-8')
    headers.set('cache-control', 'no-store')
    return new Response(JSON.stringify({ error: message }), { status, headers })
  }

  before(request: Request): Response | null {
    const requestOrigin = origin(request)
    if (requestOrigin !== null && (!requestOrigin || !this.allowedOrigins.has(requestOrigin)))
      return this.#error(403, 'Cross-origin request is not allowed')
    if (request.method !== 'OPTIONS') return null
    if (!requestOrigin) return this.#error(403, 'CORS preflight requires an allowed origin')
    const method = String(request.headers.get('access-control-request-method') || '').toUpperCase()
    if (!methodSet.has(method)) return this.#error(403, 'Requested cross-origin method is not allowed', requestOrigin)
    if (requestedHeaders(request).some((header) => !headerSet.has(header)))
      return this.#error(403, 'Requested cross-origin header is not allowed', requestOrigin)
    const headers = this.#headers(requestOrigin)
    headers.set('access-control-allow-methods', METHODS.join(', '))
    headers.set('access-control-allow-headers', HEADERS.join(', '))
    headers.set('access-control-max-age', '600')
    headers.set('cache-control', 'no-store')
    return new Response(null, { status: 204, headers })
  }

  after(request: Request, response: Response) {
    const requestOrigin = origin(request)
    if (!requestOrigin || !this.allowedOrigins.has(requestOrigin)) return response
    const headers = new Headers(response.headers)
    headers.set('access-control-allow-origin', requestOrigin)
    mergeVary(headers, 'Origin')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}

export function configuredDashboardCorsPolicy() {
  return new DashboardCorsPolicy(parseCorsAllowedOrigins(process.env.VERTEXADE_CORS_ALLOW_ORIGINS))
}

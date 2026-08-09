import type {
  ModuleCatalog,
  PortableCollectionSurface,
  PortableActionValue,
  PortableItemAction,
  PortableSettingsAction,
  PortableSettingsSurface,
} from '@vertexade/platform-contracts'
import {
  portableActionBody,
  portableActionPath,
  portableSettingsBody,
  readPortablePath,
  type PortableCollectionItem,
  type PortableSettingsValues,
} from '@vertexade/platform-contracts/portable'

export type PlatformFetch = (url: string, init?: RequestInit) => Promise<Response>
export type ApiClient = <T>(path: string, options?: PlatformRequestOptions) => Promise<T>
export type AuthenticationMode = 'none' | 'optional' | 'required'
export type PlatformRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: HeadersInit
  auth?: AuthenticationMode
}
export type PlatformRequestContext = {
  method: string
  path: string
}
export type PlatformClientOptions = {
  baseUrl?: string
  fetch?: PlatformFetch
  headers?: HeadersInit | ((context: PlatformRequestContext) => HeadersInit | Promise<HeadersInit>)
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>
  credentials?: RequestCredentials
}
export type ExtensionActionValues = Record<string, PortableActionValue>

type ErrorBody = {
  error?: unknown
  message?: unknown
  code?: unknown
  details?: unknown
}

export class PlatformApiError extends Error {
  readonly name = 'PlatformApiError'

  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
    readonly code?: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message)
  }
}

export class PlatformNetworkError extends Error {
  readonly name = 'PlatformNetworkError'

  constructor(
    message: string,
    readonly method: string,
    readonly path: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export class PlatformDecodeError extends Error {
  readonly name = 'PlatformDecodeError'

  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly path: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export class PlatformAuthenticationError extends Error {
  readonly name = 'PlatformAuthenticationError'

  constructor(readonly path: string) {
    super(`Authentication is required for ${path}`)
  }
}

export function isPlatformApiError(reason: unknown): reason is PlatformApiError {
  return reason instanceof PlatformApiError
}

export function normalizePlatformBaseUrl(value = '') {
  const normalized = value.trim().replace(/\/+$/, '')
  if (!normalized) return ''
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('Platform API URL must be an absolute HTTP or HTTPS URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Platform API URL must use HTTP or HTTPS')
  return normalized
}

function assertApiPath(path: string, label = 'Platform') {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error(`${label} API paths must be absolute and same-origin`)
  }
  const pathname = path.split(/[?#]/, 1)[0] || ''
  let decodedPathname: string
  try {
    decodedPathname = decodeURIComponent(pathname)
  } catch {
    throw new Error(`${label} API paths must use valid URL encoding`)
  }
  if (decodedPathname.split('/').includes('..')) {
    throw new Error(`${label} API paths must be absolute and cannot traverse directories`)
  }
}

export function resolvePlatformUrl(baseUrl: string, path: string) {
  assertApiPath(path)
  return baseUrl ? `${normalizePlatformBaseUrl(baseUrl)}${path}` : path
}

export function extensionApiPath(moduleId: string, path: string) {
  if (!moduleId.trim()) throw new Error('Extension id is required')
  assertApiPath(path, 'Extension')
  return `/api/extensions/${encodeURIComponent(moduleId)}${path === '/' ? '' : path}`
}

export const platformApiPaths = {
  modules: '/api/modules',
  moduleCache: (moduleId: string) => `/api/modules/${encodeURIComponent(moduleId)}/cache`,
  events: '/api/events',
} as const

export const PORTABLE_SOURCE_POLL_INTERVAL_MS = 60_000

export function portableSourceRequestPath(surface: PortableCollectionSurface, sourceValues: Record<string, string>, forceRefresh: boolean) {
  const search = new URLSearchParams()
  for (const control of surface.sourceControls || []) {
    const value = sourceValues[control.id]
    if (value) search.set(control.queryParameter, value)
  }
  if (forceRefresh) search.set('force_refresh', '1')
  return `${surface.source.path}${search.size ? `?${search}` : ''}`
}

export async function requestPortableSource<T>(
  extension: PlatformExtensionClient,
  surface: PortableCollectionSurface,
  sourceValues: Record<string, string>,
  forceRefresh: boolean,
  signal?: AbortSignal,
) {
  return extension.request<T>(portableSourceRequestPath(surface, sourceValues, forceRefresh), signal ? { signal } : {})
}

export function resolvePortableSourceValues(surface: PortableCollectionSurface, sourceValues: Record<string, string>, data: unknown) {
  const resolved = { ...sourceValues }
  let changed = false
  for (const control of surface.sourceControls || []) {
    if (resolved[control.id] || !control.selectedPath) continue
    const value = String(readPortablePath(data, control.selectedPath) || '')
    if (!value) continue
    resolved[control.id] = value
    changed = true
  }
  return changed ? resolved : sourceValues
}

export type PlatformExtensionClient = {
  readonly id: string
  resolve(path: string): string
  fetch(path: string, options?: PlatformRequestOptions): Promise<Response>
  request<T>(path: string, options?: PlatformRequestOptions): Promise<T>
  loadSurface<T = Record<string, unknown>>(surface: PortableCollectionSurface, options?: PlatformRequestOptions): Promise<T>
  loadSettings<T = Record<string, unknown>>(settings: PortableSettingsSurface, options?: PlatformRequestOptions): Promise<T>
  saveSettings<T = unknown>(settings: PortableSettingsSurface, values: PortableSettingsValues, options?: PlatformRequestOptions): Promise<T>
  executeSettingsAction<T = unknown>(
    settings: PortableSettingsSurface,
    action: PortableSettingsAction,
    values?: PortableSettingsValues,
    options?: PlatformRequestOptions,
  ): Promise<T>
  executeAction<T = unknown>(
    action: PortableItemAction,
    item?: string | Pick<PortableCollectionItem, 'id'>,
    values?: ExtensionActionValues,
    options?: PlatformRequestOptions,
  ): Promise<T>
}

export type PlatformClient = {
  resolve(path: string): string
  fetch(path: string, options?: PlatformRequestOptions): Promise<Response>
  request: ApiClient
  modules: {
    list(options?: PlatformRequestOptions): Promise<ModuleCatalog>
    clearCache(moduleId: string, options?: PlatformRequestOptions): Promise<{ moduleId: string; removed: number; stats?: unknown }>
  }
  extension(moduleId: string): PlatformExtensionClient
}

function errorBody(value: unknown): ErrorBody {
  return value && typeof value === 'object' ? (value as ErrorBody) : {}
}

function errorText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

async function configuredHeaders(options: PlatformClientOptions, context: PlatformRequestContext) {
  return typeof options.headers === 'function' ? options.headers(context) : options.headers
}

function stripClientOptions(options: PlatformRequestOptions): RequestInit {
  const { auth: _auth, ...request } = options
  return request
}

export function createPlatformClient(options: PlatformClientOptions = {}): PlatformClient {
  const baseUrl = normalizePlatformBaseUrl(options.baseUrl)
  const platformFetch = options.fetch || ((url: string, init?: RequestInit) => globalThis.fetch(url, init))

  const resolve = (path: string) => resolvePlatformUrl(baseUrl, path)

  async function prepare(path: string, requestOptions: PlatformRequestOptions = {}, json = false) {
    const method = (requestOptions.method || 'GET').toUpperCase()
    const context = { method, path }
    const headers = new Headers(await configuredHeaders(options, context))
    new Headers(requestOptions.headers).forEach((value, name) => headers.set(name, value))
    if (json && !headers.has('accept')) headers.set('accept', 'application/json')
    if (json && !headers.has('content-type')) headers.set('content-type', 'application/json')

    const authentication = requestOptions.auth || 'optional'
    const token = authentication === 'none' ? undefined : await options.getAccessToken?.()
    if (authentication === 'required' && !token) throw new PlatformAuthenticationError(path)
    if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`)

    const init: RequestInit = {
      ...stripClientOptions(requestOptions),
      method,
      headers,
      ...(options.credentials && requestOptions.credentials === undefined ? { credentials: options.credentials } : {}),
    }
    return { init, method }
  }

  async function transport(path: string, requestOptions: PlatformRequestOptions, json: boolean) {
    const { init, method } = await prepare(path, requestOptions, json)
    try {
      return await platformFetch(resolve(path), init)
    } catch (reason) {
      throw new PlatformNetworkError(`Could not reach the platform API for ${method} ${path}`, method, path, {
        cause: reason,
      })
    }
  }

  const raw = (path: string, requestOptions: PlatformRequestOptions = {}) => transport(path, requestOptions, false)

  const request: ApiClient = async <T>(path: string, requestOptions: PlatformRequestOptions = {}) => {
    const method = (requestOptions.method || 'GET').toUpperCase()
    const response = await transport(path, requestOptions, true)
    const text = await response.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch (reason) {
        if (!response.ok) {
          throw new PlatformApiError(
            `Request failed (${response.status}): ${text.slice(0, 300)}`,
            response.status,
            method,
            path,
            text,
            undefined,
            undefined,
            response.headers.get('x-request-id') || undefined,
          )
        }
        throw new PlatformDecodeError('Server returned an invalid response', response.status, method, path, {
          cause: reason,
        })
      }
    }
    if (!response.ok) {
      const body = errorBody(data)
      throw new PlatformApiError(
        errorText(body.error) || errorText(body.message) || `Request failed (${response.status})`,
        response.status,
        method,
        path,
        data,
        errorText(body.code),
        body.details,
        response.headers.get('x-request-id') || undefined,
      )
    }
    return data as T
  }

  const extension = (moduleId: string): PlatformExtensionClient => {
    const extensionPath = (path: string) => extensionApiPath(moduleId, path)
    const extensionRequest: ApiClient = (path, requestOptions) => request(extensionPath(path), requestOptions)
    return {
      id: moduleId,
      resolve: (path) => resolve(extensionPath(path)),
      fetch: (path, requestOptions) => raw(extensionPath(path), requestOptions),
      request: extensionRequest,
      loadSurface: (surface, requestOptions) => extensionRequest(surface.source.path, requestOptions),
      loadSettings: (settings, requestOptions) => extensionRequest(settings.source.path, requestOptions),
      saveSettings: (settings, values, requestOptions = {}) => {
        if (!settings.submit) throw new Error(`Portable settings ${settings.id} cannot be saved`)
        return extensionRequest(settings.submit.path, {
          ...requestOptions,
          method: settings.submit.method,
          body: JSON.stringify(portableSettingsBody(settings.fields, values)),
        })
      },
      executeSettingsAction: (settings, action, values = {}, requestOptions = {}) =>
        extensionRequest(action.path, {
          ...requestOptions,
          method: action.method,
          ...(action.method === 'DELETE'
            ? {}
            : {
                body: JSON.stringify(portableSettingsBody(settings.fields, values, action.includeFields)),
              }),
        }),
      executeAction: (action, item, values = {}, requestOptions = {}) =>
        extensionRequest(portableActionPath(action, typeof item === 'string' ? { id: item } : item), {
          ...requestOptions,
          method: action.method,
          body: JSON.stringify(portableActionBody(action.inputs, values)),
        }),
    }
  }

  return {
    resolve,
    fetch: raw,
    request,
    modules: {
      list: (requestOptions) => request(platformApiPaths.modules, requestOptions),
      clearCache: (moduleId, requestOptions = {}) =>
        request(platformApiPaths.moduleCache(moduleId), {
          ...requestOptions,
          method: 'DELETE',
        }),
    },
    extension,
  }
}

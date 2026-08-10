import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'
import { commaSeparatedValues } from './configuration.ts'

type Address = { address: string; family: 4 | 6 }
type Resolver = (hostname: string) => Promise<Address[]>
type Transport = (input: string | URL, init?: RequestInit & { dispatcher?: Agent }) => Promise<Response>
type RequestState = {
  url: URL
  method: string
  body: BodyInit | null | undefined
  headers: Headers
  init: Omit<RequestInit, 'body'>
}

export type OutboundPolicyOptions = {
  allowedOrigins?: Iterable<string>
  resolver?: Resolver
  transport?: Transport
  maxRedirects?: number
  maxPinnedHosts?: number
  onReject?: (reason: string, origin: string) => void
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key'])
const blockedV4 = new BlockList()
const blockedV6 = new BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blockedV4.addSubnet(network, prefix, 'ipv4')

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0.0.0.0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blockedV6.addSubnet(network, prefix, 'ipv6')

export class OutboundPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutboundPolicyError'
  }
}

function hostname(value: string) {
  const normalized = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
  return normalized.endsWith('.') ? normalized.slice(0, -1).toLowerCase() : normalized.toLowerCase()
}

export function normalizeOutboundUrl(input: string | URL) {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new OutboundPolicyError('Outbound URL is invalid')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new OutboundPolicyError('Outbound URL must use HTTP or HTTPS')
  if (url.username || url.password) throw new OutboundPolicyError('Outbound URL must not contain credentials')
  if (url.hash) throw new OutboundPolicyError('Outbound URL must not contain a fragment')
  if (!url.hostname) throw new OutboundPolicyError('Outbound URL must include a hostname')
  if (!url.hostname.startsWith('[')) url.hostname = hostname(url.hostname)
  return url
}

export function parseOutboundAllowedOrigins(value: string | undefined) {
  const origins = new Set<string>()
  for (const entry of commaSeparatedValues(value)) {
    if (entry.includes('*')) throw new OutboundPolicyError('Outbound allowed origins must not contain wildcards')
    const url = normalizeOutboundUrl(entry)
    if (url.pathname !== '/' || url.search || url.hash)
      throw new OutboundPolicyError('Outbound allowed origins must not contain a path, query, or fragment')
    origins.add(url.origin)
  }
  return origins
}

function blockedAddress(address: Address) {
  const family = isIP(address.address)
  if (!family || family !== address.family) return true
  return family === 4 ? blockedV4.check(address.address, 'ipv4') : blockedV6.check(address.address, 'ipv6')
}

async function defaultResolver(name: string): Promise<Address[]> {
  return (await dnsLookup(name, { all: true, verbatim: true })).map((result) => ({
    address: result.address,
    family: result.family as 4 | 6,
  }))
}

function redirectMethod(status: number, method: string) {
  return status === 303 || ((status === 301 || status === 302) && method === 'POST') ? 'GET' : method
}

function hasSensitiveHeaders(headers: Headers) {
  for (const name of SENSITIVE_HEADERS) if (headers.has(name)) return true
  return false
}

function discardBody(response: Response) {
  return response.body?.cancel().catch(() => undefined)
}

export class OutboundRequestPolicy {
  readonly allowedOrigins: ReadonlySet<string>
  readonly fetch: typeof globalThis.fetch
  readonly #resolver: Resolver
  readonly #transport: Transport
  readonly #maxRedirects: number
  readonly #maxPinnedHosts: number
  readonly #onReject: ((reason: string, origin: string) => void) | undefined
  readonly #pins = new Map<string, Address[]>()
  readonly #agent: Agent

  constructor(options: OutboundPolicyOptions = {}) {
    this.allowedOrigins = new Set(options.allowedOrigins || [])
    this.#resolver = options.resolver || defaultResolver
    this.#transport = options.transport || (undiciFetch as unknown as Transport)
    this.#maxRedirects = options.maxRedirects ?? 5
    this.#maxPinnedHosts = options.maxPinnedHosts ?? 128
    this.#onReject = options.onReject
    this.#agent = new Agent({
      maxOrigins: this.#maxPinnedHosts,
      connect: { lookup: this.#lookup as any },
    })
    this.fetch = this.#fetch.bind(this) as typeof globalThis.fetch
  }

  readonly #lookup = (name: string, options: { all?: boolean }, callback: (...values: any[]) => void) => {
    const addresses = this.#pins.get(hostname(name))
    if (!addresses?.length) return callback(new OutboundPolicyError('Outbound address was not pinned before connection'))
    if (options.all) return callback(null, addresses)
    const selected = addresses[0]!
    return callback(null, selected.address, selected.family)
  }

  #reject(reason: string, url: URL): never {
    this.#onReject?.(reason, url.origin)
    throw new OutboundPolicyError(reason)
  }

  #pin(name: string, addresses: Address[]) {
    const key = hostname(name)
    this.#pins.delete(key)
    this.#pins.set(key, addresses)
    while (this.#pins.size > this.#maxPinnedHosts) this.#pins.delete(this.#pins.keys().next().value!)
  }

  async #validate(input: string | URL) {
    const url = normalizeOutboundUrl(input)
    const name = hostname(url.hostname)
    let addresses: Address[]
    try {
      addresses = await this.#resolver(name)
    } catch {
      return this.#reject('Outbound hostname could not be resolved', url)
    }
    if (!addresses.length) return this.#reject('Outbound hostname did not resolve to an address', url)
    if (!this.allowedOrigins.has(url.origin) && addresses.some(blockedAddress))
      return this.#reject('Outbound destination resolves to a non-public address', url)
    this.#pin(name, addresses)
    return url
  }

  async #requestState(input: string | URL | Request, init: RequestInit): Promise<RequestState> {
    const { body: initialBody, ...baseInit } = init
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init.headers).forEach((value, name) => headers.set(name, value))
    return {
      url: await this.#validate(input instanceof Request ? input.url : input),
      method: String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(),
      body: initialBody,
      headers,
      init: baseInit,
    }
  }

  #dispatch(state: RequestState) {
    return this.#transport(state.url, {
      ...state.init,
      method: state.method,
      headers: state.headers,
      ...(state.body === undefined || state.body === null ? {} : { body: state.body }),
      redirect: 'manual',
      dispatcher: this.#agent,
    })
  }

  async #redirectUrl(response: Response, state: RequestState, redirect: number) {
    if (redirect >= this.#maxRedirects) {
      await discardBody(response)
      return this.#reject('Outbound request exceeded its redirect limit', state.url)
    }
    const location = response.headers.get('location')
    if (!location) {
      await discardBody(response)
      return this.#reject('Outbound redirect did not include a location', state.url)
    }
    await discardBody(response)
    return this.#validate(new URL(location, state.url))
  }

  #redirectMethod(response: Response, state: RequestState) {
    const method = redirectMethod(response.status, state.method)
    if (method === 'GET' && state.method !== 'GET') {
      state.headers.delete('content-length')
      state.headers.delete('content-type')
      return { method, body: undefined }
    }
    return { method, body: state.body }
  }

  async #redirectState(response: Response, state: RequestState, redirect: number): Promise<RequestState> {
    const url = await this.#redirectUrl(response, state, redirect)
    if (url.origin !== state.url.origin && hasSensitiveHeaders(state.headers))
      return this.#reject('Outbound credentials cannot cross an origin redirect', url)
    return { ...state, ...this.#redirectMethod(response, state), url }
  }

  async #fetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    let state = await this.#requestState(input, init)

    for (let redirect = 0; ; redirect += 1) {
      const response = await this.#dispatch(state)
      if (!REDIRECT_STATUSES.has(response.status)) return response
      state = await this.#redirectState(response, state, redirect)
    }
  }

  async dispose() {
    await this.#agent.close()
    this.#pins.clear()
  }
}

let configuredPolicy: OutboundRequestPolicy | undefined

export function configuredOutboundPolicy() {
  if (!configuredPolicy) {
    const allowedOrigins = parseOutboundAllowedOrigins(process.env.VERTEXADE_OUTBOUND_ALLOW_ORIGINS)
    configuredPolicy = new OutboundRequestPolicy({
      allowedOrigins,
      onReject: (reason, origin) => console.warn(`Blocked outbound integration request to ${origin}: ${reason}`),
    })
    if (allowedOrigins.size) console.info(`Outbound private integration origins: ${[...allowedOrigins].join(', ')}`)
  }
  return configuredPolicy
}

export const guardedIntegrationFetch: typeof globalThis.fetch = (input, init) => configuredOutboundPolicy().fetch(input, init)

export async function disposeConfiguredOutboundPolicy() {
  const policy = configuredPolicy
  configuredPolicy = undefined
  await policy?.dispose()
}

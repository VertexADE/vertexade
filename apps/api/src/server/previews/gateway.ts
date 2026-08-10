import { createServer, request as httpRequest, type IncomingHttpHeaders, type OutgoingHttpHeaders, type Server } from 'node:http'
import { connect } from 'node:net'
import type { Socket } from 'node:net'
import type { PreviewSettings } from './runtime.ts'

export type PreviewTarget = { hostPort: number } | null
export type PreviewTargetResolver = (hostname: string) => PreviewTarget

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const FORWARDED_HEADERS = new Set(['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'])

function connectionHeaderNames(headers: IncomingHttpHeaders) {
  return new Set(
    String(headers.connection || '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  )
}

function forwardedHeaders(headers: IncomingHttpHeaders, additionallyExcluded: ReadonlySet<string> = new Set()): OutgoingHttpHeaders {
  const connectionHeaders = connectionHeaderNames(headers)
  const result: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase()
    if (
      value === undefined ||
      HOP_BY_HOP_HEADERS.has(normalizedName) ||
      connectionHeaders.has(normalizedName) ||
      additionallyExcluded.has(normalizedName)
    )
      continue
    result[name] = value
  }
  return result
}

export function previewRequestHeaders({
  headers,
  hostname,
  remoteAddress,
  upgrade = false,
}: {
  headers: IncomingHttpHeaders
  hostname: string
  remoteAddress: string | undefined
  upgrade?: boolean
}): OutgoingHttpHeaders {
  const result = forwardedHeaders(headers, FORWARDED_HEADERS)
  result['x-forwarded-host'] = headers.host || hostname
  result['x-forwarded-proto'] = 'http'
  if (remoteAddress) result['x-forwarded-for'] = remoteAddress
  if (upgrade) {
    result.connection = 'Upgrade'
    result.upgrade = headers.upgrade || 'websocket'
  }
  return result
}

export function previewResponseHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  return forwardedHeaders(headers)
}

function requestHostname(host: string | undefined) {
  const value = String(host || '')
    .trim()
    .toLowerCase()
  if (value.startsWith('[')) return value.slice(1, value.indexOf(']'))
  return value.split(':')[0]
}

export function hostnameBelongsToDomain(hostname: string, domain: string) {
  return Boolean(hostname && domain && hostname.endsWith(`.${domain}`) && hostname.length > domain.length + 1)
}

export class WorktreePreviewGateway {
  private server: Server | null = null
  private settings: PreviewSettings = { domain: '', gatewayPort: 4180 }
  private resolver: PreviewTargetResolver = () => null
  private readonly sockets = new Set<Socket>()

  async configure(settings: PreviewSettings, resolver: PreviewTargetResolver) {
    const changedPort = this.settings.gatewayPort !== settings.gatewayPort
    this.settings = settings
    this.resolver = resolver
    if (!settings.domain) return this.stop()
    if (this.server && !changedPort) return
    await this.stop()
    await this.start()
  }

  async stop() {
    if (!this.server) return
    const server = this.server
    this.server = null
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private async start() {
    const server = createServer(
      {
        headersTimeout: 15_000,
        keepAliveTimeout: 5_000,
        maxHeaderSize: 16 * 1024,
        requestTimeout: 120_000,
      },
      (incoming, outgoing) => {
        const hostname = requestHostname(incoming.headers.host)
        const target = hostnameBelongsToDomain(hostname, this.settings.domain) ? this.resolver(hostname) : null
        if (!target) {
          outgoing.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          return outgoing.end('Preview service not found')
        }
        const upstream = httpRequest(
          {
            hostname: '127.0.0.1',
            port: target.hostPort,
            method: incoming.method,
            path: incoming.url,
            headers: previewRequestHeaders({
              headers: incoming.headers,
              hostname,
              remoteAddress: incoming.socket.remoteAddress,
            }),
          },
          (response) => {
            outgoing.writeHead(response.statusCode || 502, previewResponseHeaders(response.headers))
            response.pipe(outgoing)
          },
        )
        upstream.on('error', () => {
          if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
          if (!outgoing.writableEnded) outgoing.end('Preview service is not ready')
        })
        incoming.pipe(upstream)
      },
    )
    server.maxHeadersCount = 100
    server.on('upgrade', (request, socket, head) => {
      const hostname = requestHostname(request.headers.host)
      const target = hostnameBelongsToDomain(hostname, this.settings.domain) ? this.resolver(hostname) : null
      if (!target) return socket.destroy()
      const upstream = connect(target.hostPort, '127.0.0.1', () => {
        const headers = Object.entries(
          previewRequestHeaders({
            headers: request.headers,
            hostname,
            remoteAddress: request.socket.remoteAddress,
            upgrade: true,
          }),
        ).flatMap(([name, value]) =>
          Array.isArray(value) ? value.map((item) => `${name}: ${item}`) : value === undefined ? [] : [`${name}: ${value}`],
        )
        upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`)
        if (head.length) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
      })
      upstream.on('error', () => socket.destroy())
    })
    server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.once('close', () => this.sockets.delete(socket))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.settings.gatewayPort, '0.0.0.0', () => {
        server.off('error', reject)
        resolve()
      })
    })
    this.server = server
    console.log(`Worktree preview gateway listening on http://*.${this.settings.domain}:${this.settings.gatewayPort}`)
  }
}

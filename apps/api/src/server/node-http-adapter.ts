import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pumpResponseBody } from './http-response.ts'
import { TRANSPORT_CLIENT_IP_HEADER } from './transport-context.ts'

function transportLifecycle(request: IncomingMessage, response: ServerResponse) {
  const abort = new AbortController()
  const onRequestAborted = () => abort.abort()
  const onResponseClose = () => {
    if (!response.writableEnded) abort.abort()
  }
  request.once('aborted', onRequestAborted)
  response.once('close', onResponseClose)
  return {
    signal: abort.signal,
    cleanup() {
      request.off('aborted', onRequestAborted)
      response.off('close', onResponseClose)
    },
  }
}

function fetchRequest(request: IncomingMessage, origin: string, signal: AbortSignal) {
  const body = ['GET', 'HEAD'].includes(request.method || 'GET') ? undefined : Readable.toWeb(request)
  const headers = new Headers(request.headers as HeadersInit)
  headers.set(TRANSPORT_CLIENT_IP_HEADER, request.socket.remoteAddress || 'unknown')
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    body,
    duplex: body ? 'half' : undefined,
    signal,
  }
  return new Request(new URL(request.url || '/', origin), init)
}

async function writeResponse(response: ServerResponse, source: Response, signal: AbortSignal, writeTimeoutMs: number) {
  response.writeHead(source.status, Object.fromEntries(source.headers))
  if (source.body) await pumpResponseBody(source.body, response, { signal, writeTimeoutMs })
  if (!response.destroyed && !response.writableEnded) response.end()
}

export async function serveNodeRequest({
  request,
  response,
  origin,
  writeTimeoutMs,
  handle,
}: {
  request: IncomingMessage
  response: ServerResponse
  origin: string
  writeTimeoutMs: number
  handle(request: Request): Promise<Response>
}) {
  const lifecycle = transportLifecycle(request, response)
  try {
    const result = await handle(fetchRequest(request, origin, lifecycle.signal))
    await writeResponse(response, result, lifecycle.signal, writeTimeoutMs)
  } finally {
    lifecycle.cleanup()
  }
}

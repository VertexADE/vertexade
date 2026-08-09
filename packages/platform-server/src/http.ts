export const MAX_REQUEST_BODY_BYTES = 100_000
export const MAX_RESPONSE_BODY_BYTES = 1_000_000

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export async function readRequestBody(request: Request, maxBytes = MAX_REQUEST_BODY_BYTES): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Request body limit must be a non-negative safe integer')
  const header = request.headers.get('content-length')?.trim()
  const contentLength = header && /^(0|[1-9]\d*)$/.test(header) ? Number(header) : Number.NaN
  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
    throw new HttpError('Request body is too large', 413)
  }
  if (!request.body) return Buffer.alloc(0)

  const chunks: Uint8Array[] = []
  const reader = request.body.getReader()
  let size = 0
  try {
    while (true) {
      if (request.signal.aborted) throw new HttpError('Request body was aborted', 400)
      let onAbort: (() => void) | undefined
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new HttpError('Request body was aborted', 400))
        request.signal.addEventListener('abort', onAbort, { once: true })
      })
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await Promise.race([reader.read(), aborted])
      } catch (error) {
        await reader.cancel(error).catch(() => undefined)
        throw error
      } finally {
        if (onAbort) request.signal.removeEventListener('abort', onAbort)
      }
      const { done, value } = chunk
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel('Request body is too large')
        throw new HttpError('Request body is too large', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

export async function readJsonObject(request: Request, maxBytes = MAX_REQUEST_BODY_BYTES): Promise<Record<string, unknown>> {
  const payload = await readRequestBody(request, maxBytes)
  let value: unknown
  try {
    value = JSON.parse(payload.toString('utf8'))
  } catch {
    throw new HttpError('Request body must contain valid JSON', 400)
  }
  if (!isRecord(value)) throw new HttpError('Request body must be a JSON object', 400)
  return value
}

export async function readResponseBody(
  response: Response,
  maxBytes = MAX_RESPONSE_BODY_BYTES,
  signal?: AbortSignal | null,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Response body limit must be a non-negative safe integer')
  const header = response.headers?.get?.('content-length')?.trim()
  const contentLength = header && /^(0|[1-9]\d*)$/.test(header) ? Number(header) : Number.NaN
  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) throw new Error('Response body is too large')
  if (!response.body) {
    const text = typeof response.text === 'function' ? await response.text() : ''
    const payload = Buffer.from(text)
    if (payload.byteLength > maxBytes) throw new Error('Response body is too large')
    return payload
  }

  const chunks: Uint8Array[] = []
  const reader = response.body.getReader()
  let size = 0
  try {
    while (true) {
      if (signal?.aborted) throw new Error('Response body read was cancelled')
      let onAbort: (() => void) | undefined
      const aborted = new Promise<never>((_, reject) => {
        if (!signal) return
        onAbort = () => reject(new Error('Response body read was cancelled'))
        signal.addEventListener('abort', onAbort, { once: true })
      })
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await Promise.race([reader.read(), aborted])
      } catch (error) {
        await reader.cancel(error).catch(() => undefined)
        throw error
      } finally {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      }
      const { done, value } = chunk
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel('Response body is too large')
        throw new Error('Response body is too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

export async function parseJsonResponse(
  response: Response,
  service: string,
  maxBytes = MAX_RESPONSE_BODY_BYTES,
  signal?: AbortSignal | null,
): Promise<unknown> {
  let text: string
  try {
    text = (await readResponseBody(response, maxBytes, signal)).toString('utf8')
  } catch (error) {
    if (error instanceof Error && error.message === 'Response body is too large') throw new Error(`${service} response is too large`)
    throw error
  }
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      if (!response.ok) throw new Error(`${service} returned ${response.status}: ${text.slice(0, 500)}`)
      throw new Error(`${service} returned invalid JSON`)
    }
  }
  if (!response.ok) {
    const record = isRecord(data) ? data : null
    const detail = record?.message ?? record?.error ?? record?.detail
    const message = detail ? String(detail) : `${service} request failed (${response.status})${text ? `: ${text.slice(0, 500)}` : ''}`
    throw new Error(message)
  }
  return data
}

export function requestSignal(signal?: AbortSignal | null, timeoutMs = 15_000): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
}

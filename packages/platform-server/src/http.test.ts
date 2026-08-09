import { describe, expect, it } from 'vite-plus/test'
import { parseJsonResponse, readJsonObject, readRequestBody, readResponseBody, requestSignal } from './http.ts'

describe('HTTP boundaries', () => {
  it('rejects oversized request bodies from content length before reading them', async () => {
    const request = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-length': '101' },
      body: 'small',
    })
    await expect(readRequestBody(request, 100)).rejects.toEqual(
      expect.objectContaining({ status: 413, message: 'Request body is too large' }),
    )
  })

  it('rejects oversized chunked request bodies while streaming', async () => {
    const request = new Request('http://localhost/api', { method: 'POST', body: 'x'.repeat(101) })
    request.headers.delete('content-length')
    await expect(readRequestBody(request, 100)).rejects.toEqual(
      expect.objectContaining({ status: 413, message: 'Request body is too large' }),
    )
  })

  it('accepts the exact body limit and rejects one byte more', async () => {
    await expect(
      readRequestBody(new Request('http://localhost/api', { method: 'POST', body: 'x'.repeat(100) }), 100),
    ).resolves.toHaveLength(100)
    await expect(readRequestBody(new Request('http://localhost/api', { method: 'POST', body: 'x'.repeat(101) }), 100)).rejects.toEqual(
      expect.objectContaining({ status: 413 }),
    )
  })

  it('streams bodies with missing or malformed content lengths through the byte limit', async () => {
    for (const contentLength of [null, 'not-a-number', '-1', '1.5']) {
      const headers = new Headers()
      if (contentLength !== null) headers.set('content-length', contentLength)
      const request = new Request('http://localhost/api', {
        method: 'POST',
        headers,
        body: 'x'.repeat(101),
      })
      await expect(readRequestBody(request, 100)).rejects.toEqual(expect.objectContaining({ status: 413 }))
    }
  })

  it('does not trust a declared length that is smaller than the streamed body', async () => {
    const request = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-length': '1' },
      body: 'x'.repeat(101),
    })
    await expect(readRequestBody(request, 100)).rejects.toEqual(expect.objectContaining({ status: 413 }))
  })

  it('cancels an aborted body read without hanging', async () => {
    const controller = new AbortController()
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull() {},
      cancel() {
        cancelled = true
      },
    })
    const request = new Request('http://localhost/api', {
      method: 'POST',
      body,
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit)
    const reading = readRequestBody(request)

    controller.abort()

    await expect(reading).rejects.toEqual(expect.objectContaining({ status: 400, message: 'Request body was aborted' }))
    expect(cancelled).toBe(true)
  })

  it('preserves non-JSON upstream errors', async () => {
    const response = new Response('gateway unavailable', { status: 502 })
    await expect(parseJsonResponse(response, 'Example')).rejects.toThrow('Example returned 502: gateway unavailable')
  })

  it('rejects declared and streamed oversized response bodies', async () => {
    await expect(readResponseBody(new Response('small', { headers: { 'content-length': '101' } }), 100)).rejects.toThrow(
      'Response body is too large',
    )
    await expect(readResponseBody(new Response('x'.repeat(101)), 100)).rejects.toThrow('Response body is too large')
  })

  it('cancels a stalled response body when its signal aborts', async () => {
    const controller = new AbortController()
    let cancelled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {},
        cancel() {
          cancelled = true
        },
      }),
    )
    const reading = readResponseBody(response, 100, controller.signal)

    controller.abort()

    await expect(reading).rejects.toThrow('Response body read was cancelled')
    expect(cancelled).toBe(true)
  })

  it('accepts JSON objects and rejects other JSON request shapes', async () => {
    await expect(
      readJsonObject(
        new Request('http://localhost/api', {
          method: 'POST',
          body: JSON.stringify({ name: 'extension' }),
        }),
      ),
    ).resolves.toEqual({ name: 'extension' })
    await expect(
      readJsonObject(
        new Request('http://localhost/api', {
          method: 'POST',
          body: JSON.stringify(['extension']),
        }),
      ),
    ).rejects.toEqual(expect.objectContaining({ status: 400, message: 'Request body must be a JSON object' }))
  })

  it('rejects malformed JSON request bodies with a typed HTTP error', async () => {
    await expect(
      readJsonObject(
        new Request('http://localhost/api', {
          method: 'POST',
          body: '{',
        }),
      ),
    ).rejects.toEqual(expect.objectContaining({ status: 400, message: 'Request body must contain valid JSON' }))
  })

  it('enforces the shared byte limit before parsing JSON', async () => {
    await expect(
      readJsonObject(
        new Request('http://localhost/api', {
          method: 'POST',
          body: JSON.stringify({ value: 'x'.repeat(100) }),
        }),
        100,
      ),
    ).rejects.toEqual(expect.objectContaining({ status: 413, message: 'Request body is too large' }))
  })

  it('combines caller cancellation with a timeout', () => {
    const controller = new AbortController()
    const signal = requestSignal(controller.signal, 60_000)
    controller.abort()
    expect(signal.aborted).toBe(true)
  })
})

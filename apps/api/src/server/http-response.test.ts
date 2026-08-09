import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vite-plus/test'
import { configuredResponseWriteTimeout, pumpResponseBody, ResponseTransportError, ResponseWriteTimeoutError } from './http-response.ts'

function body(chunks: string[]) {
  const read = vi.fn()
  for (const chunk of chunks) read.mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunk) })
  read.mockResolvedValueOnce({ done: true, value: undefined })
  const cancel = vi.fn(async () => undefined)
  const releaseLock = vi.fn()
  return {
    stream: { getReader: () => ({ read, cancel, releaseLock }) } as any,
    read,
    cancel,
    releaseLock,
  }
}

function destination(write: (chunk: Uint8Array) => boolean) {
  const events = new EventEmitter() as any
  events.destroyed = false
  events.writableEnded = false
  events.write = vi.fn(write)
  events.destroy = vi.fn(() => {
    events.destroyed = true
  })
  return events
}

describe('HTTP response body pump', () => {
  it('does not read another chunk until a backpressured destination drains', async () => {
    const source = body(['one', 'two'])
    let writes = 0
    const output = destination(() => ++writes > 1)
    const pumping = pumpResponseBody(source.stream, output, { signal: new AbortController().signal, writeTimeoutMs: 100 })
    await vi.waitFor(() => expect(source.read).toHaveBeenCalledTimes(1))
    expect(output.write).toHaveBeenCalledTimes(1)
    output.emit('drain')
    await pumping
    expect(source.read).toHaveBeenCalledTimes(3)
    expect(output.write).toHaveBeenCalledTimes(2)
  })

  it('cancels the source when the destination closes while backpressured', async () => {
    const source = body(['one', 'two'])
    const output = destination(() => false)
    const pumping = pumpResponseBody(source.stream, output, { signal: new AbortController().signal, writeTimeoutMs: 100 })
    await vi.waitFor(() => expect(output.write).toHaveBeenCalledOnce())
    output.destroyed = true
    output.emit('close')
    await expect(pumping).rejects.toBeInstanceOf(ResponseTransportError)
    expect(source.cancel).toHaveBeenCalledOnce()
    expect(source.read).toHaveBeenCalledOnce()
  })

  it('times out a write, cancels the source, and destroys the destination', async () => {
    const source = body(['one'])
    const output = destination(() => false)
    await expect(
      pumpResponseBody(source.stream, output, { signal: new AbortController().signal, writeTimeoutMs: 5 }),
    ).rejects.toBeInstanceOf(ResponseWriteTimeoutError)
    expect(source.cancel).toHaveBeenCalledOnce()
    expect(output.destroy).toHaveBeenCalledOnce()
  })

  it('cancels the source on caller abort', async () => {
    const source = body(['one'])
    const output = destination(() => false)
    const abort = new AbortController()
    const pumping = pumpResponseBody(source.stream, output, { signal: abort.signal, writeTimeoutMs: 100 })
    await vi.waitFor(() => expect(output.write).toHaveBeenCalledOnce())
    abort.abort()
    await expect(pumping).rejects.toBeInstanceOf(ResponseTransportError)
    expect(source.cancel).toHaveBeenCalledOnce()
  })

  it('validates the configured write timeout', () => {
    expect(configuredResponseWriteTimeout({})).toBe(15_000)
    expect(configuredResponseWriteTimeout({ VERTEXADE_HTTP_WRITE_TIMEOUT_MS: '2500' })).toBe(2_500)
    expect(() => configuredResponseWriteTimeout({ VERTEXADE_HTTP_WRITE_TIMEOUT_MS: '0' })).toThrow('integer from 1000')
  })
})

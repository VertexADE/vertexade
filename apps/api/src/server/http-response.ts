import type { ServerResponse } from 'node:http'

export class ResponseTransportError extends Error {}
export class ResponseWriteTimeoutError extends ResponseTransportError {}

export function configuredResponseWriteTimeout(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.VERTEXADE_HTTP_WRITE_TIMEOUT_MS
  if (value === undefined || value === '') return 15_000
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000)
    throw new Error('VERTEXADE_HTTP_WRITE_TIMEOUT_MS must be an integer from 1000 to 120000')
  return parsed
}

function aborted() {
  return new ResponseTransportError('HTTP response transport was aborted')
}

function waitForDrain(destination: ServerResponse, signal: AbortSignal, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      destination.off('drain', onDrain)
      destination.off('close', onClose)
      destination.off('error', onError)
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onDrain = () => finish()
    const onClose = () => finish(aborted())
    const onError = (error: Error) => finish(new ResponseTransportError(error.message))
    const onAbort = () => finish(aborted())
    const timeout = setTimeout(() => finish(new ResponseWriteTimeoutError('HTTP response write timed out')), timeoutMs)
    timeout.unref()
    destination.once('drain', onDrain)
    destination.once('close', onClose)
    destination.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted || destination.destroyed) finish(aborted())
  })
}

export async function pumpResponseBody(
  body: ReadableStream<Uint8Array>,
  destination: ServerResponse,
  { signal, writeTimeoutMs = 15_000 }: { signal: AbortSignal; writeTimeoutMs?: number },
) {
  const reader = body.getReader()
  try {
    while (true) {
      if (signal.aborted || destination.destroyed) throw aborted()
      const chunk = await reader.read()
      if (chunk.done) return
      if (!destination.write(Buffer.from(chunk.value))) await waitForDrain(destination, signal, writeTimeoutMs)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    if (error instanceof ResponseWriteTimeoutError && !destination.destroyed) destination.destroy()
    throw error
  } finally {
    reader.releaseLock()
  }
}

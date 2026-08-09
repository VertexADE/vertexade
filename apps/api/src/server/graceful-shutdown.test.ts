import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { closeHttpServer } from './graceful-shutdown.ts'

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

describe('graceful HTTP shutdown', () => {
  it('stops accepting connections and runs cleanup', async () => {
    const server = createServer((_request, response) => response.end('ok'))
    servers.push(server)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const cleanup = vi.fn(async () => undefined)

    await expect(closeHttpServer(server, cleanup, 100)).resolves.toEqual({ forced: false })
    expect(cleanup).toHaveBeenCalledOnce()
    expect(server.listening).toBe(false)
  })

  it('forces lingering connections after the deadline', async () => {
    let markRequestReceived: () => void = () => undefined
    const requestReceived = new Promise<void>((resolve) => {
      markRequestReceived = resolve
    })
    const server = createServer(() => markRequestReceived())
    servers.push(server)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind')
    const response = fetch(`http://127.0.0.1:${address.port}`).catch(() => undefined)
    await requestReceived

    await expect(closeHttpServer(server, async () => undefined, 10)).resolves.toEqual({
      forced: true,
    })
    await response
  })
})

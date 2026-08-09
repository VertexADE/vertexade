import type { Server } from 'node:http'

export async function closeHttpServer(server: Server, cleanup: () => Promise<void>, timeoutMs = 10_000) {
  let forced = false
  const timeout = setTimeout(() => {
    forced = true
    server.closeAllConnections()
  }, timeoutMs)
  timeout.unref()
  try {
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
        server.closeIdleConnections()
      }),
      cleanup(),
    ])
  } finally {
    clearTimeout(timeout)
  }
  return { forced }
}

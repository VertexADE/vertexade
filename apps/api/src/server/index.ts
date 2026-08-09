import { createServer } from 'node:http'
import { handleDashboardRequest, startDashboardPreviewGateway, stopDashboardRuntime } from '../dashboard-server.ts'
import { closeHttpServer } from './graceful-shutdown.ts'
import { configuredResponseWriteTimeout, ResponseTransportError } from './http-response.ts'
import { serveNodeRequest } from './node-http-adapter.ts'

const host = process.env.API_HOST || '127.0.0.1'
const port = Number(process.env.API_PORT || 4174)
const responseWriteTimeoutMs = configuredResponseWriteTimeout()
let ready = false
let shuttingDown = false

async function serve(request, response) {
  if (request.url === '/healthz') {
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    return response.end(JSON.stringify({ status: 'ok' }))
  }
  if (request.url === '/readyz') {
    response.writeHead(ready && !shuttingDown ? 200 : 503, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    return response.end(JSON.stringify({ status: ready && !shuttingDown ? 'ready' : 'unavailable' }))
  }
  const origin = `http://${request.headers.host || `${host}:${port}`}`
  await serveNodeRequest({ request, response, origin, writeTimeoutMs: responseWriteTimeoutMs, handle: handleDashboardRequest })
}

const server = createServer((request, response) => {
  void serve(request, response).catch((error) => {
    if (!(error instanceof ResponseTransportError)) console.error('Dashboard API request failed:', error)
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    if (!response.writableEnded) response.end(JSON.stringify({ error: 'Unexpected error' }))
  })
})

server.listen(port, host, () => {
  ready = true
  console.log(`Dashboard API listening on http://${host}:${port}`)
  void startDashboardPreviewGateway().catch((error) => console.error('Worktree preview gateway could not start:', error))
})

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return
  shuttingDown = true
  ready = false
  console.log(`Received ${signal}; draining HTTP connections`)
  try {
    const result = await closeHttpServer(server, stopDashboardRuntime)
    if (result.forced) console.warn('Forced lingering HTTP connections closed after shutdown deadline')
    process.exitCode = 0
  } catch (error) {
    console.error('Graceful shutdown failed:', error)
    process.exitCode = 1
  } finally {
    process.exit()
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})
process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})

#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { createServer, get, type IncomingMessage } from 'node:http'
import { DashboardEvents } from '../apps/api/src/server/events/dashboard-events.ts'
import { ResponseTransportError } from '../apps/api/src/server/http-response.ts'
import { serveNodeRequest } from '../apps/api/src/server/node-http-adapter.ts'
import { transportClientIdentity } from '../apps/api/src/server/transport-context.ts'

async function descriptors() {
  return (await readdir('/proc/self/fd')).length
}

function openClient(url: string) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode !== 200) response.resume()
      resolve(response)
    })
    request.once('error', reject)
  })
}

async function closeServer(server: ReturnType<typeof createServer>) {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

const baselineDescriptors = await descriptors()
const baselineHeap = process.memoryUsage().heapUsed
const events = new DashboardEvents({
  heartbeatMilliseconds: 60_000,
  maxClients: 8,
  maxClientsPerIdentity: 8,
  maxQueuedBytes: 64 * 1024,
  maxEventBytes: 32 * 1024,
})
const server = createServer((request, response) => {
  const origin = `http://${request.headers.host}`
  void serveNodeRequest({
    request,
    response,
    origin,
    writeTimeoutMs: 1_000,
    handle: async (fetchRequest) => events.stream({ signal: fetchRequest.signal, identity: transportClientIdentity(fetchRequest) }),
  }).catch((error) => {
    if (!(error instanceof ResponseTransportError)) response.destroy(error as Error)
  })
})

await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Expected a TCP load-probe server')
const clients = await Promise.all(Array.from({ length: 32 }, () => openClient(`http://127.0.0.1:${address.port}/api/events`)))

assert.equal(clients.filter((response) => response.statusCode === 200).length, 8)
assert.equal(clients.filter((response) => response.statusCode === 429).length, 24)
assert.deepEqual(events.stats(), { connected: 8, rejected: 24, slow_disconnected: 0, closed: 0 })
assert.ok((await descriptors()) <= baselineDescriptors + 70, 'connection/file-descriptor growth exceeded the bounded probe budget')

for (let index = 0; index < 100; index += 1) events.emit(`work_${'x'.repeat(16 * 1024)}`, index)
assert.equal(events.stats().connected, 0)
assert.equal(events.stats().slow_disconnected, 8)
assert.ok(process.memoryUsage().heapUsed - baselineHeap < 32 * 1024 * 1024, 'heap growth exceeded the load-probe budget')

for (const client of clients) client.destroy()
events.dispose()
await closeServer(server)
await new Promise((resolve) => {
  setTimeout(resolve, 25)
})
assert.ok((await descriptors()) <= baselineDescriptors + 5, 'load probe leaked sockets or file descriptors')

process.stdout.write(
  `${JSON.stringify({
    accepted: 8,
    rejected: 24,
    slowDisconnected: 8,
    heapDeltaBytes: process.memoryUsage().heapUsed - baselineHeap,
    finalDescriptorDelta: (await descriptors()) - baselineDescriptors,
  })}\n`,
)

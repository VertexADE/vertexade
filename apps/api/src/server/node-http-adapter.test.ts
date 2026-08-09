import { createServer } from 'node:http'
import { describe, expect, it } from 'vite-plus/test'
import { serveNodeRequest } from './node-http-adapter.ts'
import { TRANSPORT_CLIENT_IP_HEADER } from './transport-context.ts'

describe('Node HTTP adapter', () => {
  it('overwrites caller-controlled transport identity and returns the Fetch response', async () => {
    let observedIdentity = ''
    const server = createServer((request, response) => {
      void serveNodeRequest({
        request,
        response,
        origin: `http://${request.headers.host}`,
        writeTimeoutMs: 100,
        handle: async (fetchRequest) => {
          observedIdentity = fetchRequest.headers.get(TRANSPORT_CLIENT_IP_HEADER) || ''
          return new Response('adapter-ok', { headers: { 'x-adapter': 'tested' } })
        },
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test server')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/probe`, {
        headers: { [TRANSPORT_CLIENT_IP_HEADER]: 'spoofed-client' },
      })
      await expect(response.text()).resolves.toBe('adapter-ok')
      expect(response.headers.get('x-adapter')).toBe('tested')
      expect(observedIdentity).toMatch(/127\.0\.0\.1$/)
      expect(observedIdentity).not.toBe('spoofed-client')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })
})

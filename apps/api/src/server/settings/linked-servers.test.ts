import { createServer } from 'node:http'
import { describe, expect, it } from 'vite-plus/test'
import {
  normalizeLinkedServer,
  readLinkedServers,
  verifyLinkedServerAccess,
  verifyLinkedServer,
  writeLinkedServers,
} from './linked-servers.ts'

function memoryStore(initial: unknown[] = []) {
  let value = initial
  return {
    read: <T>(_key: string, fallback: T) => (value as T) ?? fallback,
    write: (_key: string, next: unknown) => {
      value = next as unknown[]
    },
    value: () => value,
  }
}

describe('linked servers', () => {
  it('normalizes linked server identities and origins', () => {
    expect(normalizeLinkedServer({ id: 'Team_1', label: 'Team', url: 'https://one.example/' })).toEqual({
      id: 'team_1',
      label: 'Team',
      url: 'https://one.example',
      namespace: 0,
      enabled: true,
    })
  })

  it('preserves valid stored entries', () => {
    const store = memoryStore([
      { id: 'one', label: 'One', url: 'https://one.example', enabled: true },
      { id: 'two', label: 'Two', url: 'https://two.example', enabled: true },
    ])
    expect(readLinkedServers(store)).toHaveLength(2)
    writeLinkedServers(store, readLinkedServers(store))
    expect(store.value()).toHaveLength(2)
  })

  it('requires a compatible VertexADE identity response', async () => {
    const fetch = async () => Response.json({ instanceId: 'remote-instance', version: 7 })
    await expect(verifyLinkedServer('https://one.example', fetch)).resolves.toEqual({ instanceId: 'remote-instance', version: 7 })
    await expect(verifyLinkedServer('https://one.example', async () => Response.json({ service: 'other' }))).rejects.toThrow(
      'not a compatible VertexADE server',
    )
  })

  it('verifies an operator-approved private server origin', async () => {
    let requests = 0
    const server = createServer((request, response) => {
      requests += 1
      if (request.url !== '/api/read-model/status') {
        response.writeHead(404).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ instanceId: 'private-instance', version: 9 }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test server')
    const url = `http://127.0.0.1:${address.port}`

    try {
      await expect(verifyLinkedServerAccess(url, null, '')).rejects.toMatchObject({ code: 'operator_token_not_configured' })
      await expect(verifyLinkedServerAccess(url, 'Bearer wrong', 'operator-secret')).rejects.toMatchObject({
        code: 'invalid_operator_token',
      })
      expect(requests).toBe(0)
      await expect(verifyLinkedServerAccess(url, 'Bearer operator-secret', 'operator-secret')).resolves.toEqual({
        instanceId: 'private-instance',
        version: 9,
      })
      expect(requests).toBe(1)
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

import { createServer } from 'node:http'
import { describe, expect, it } from 'vite-plus/test'
import {
  normalizeLinkedServer,
  readLinkedServers,
  verifyApprovedLinkedServer,
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
    const server = createServer((request, response) => {
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

    try {
      await expect(verifyApprovedLinkedServer(`http://127.0.0.1:${address.port}`)).resolves.toEqual({
        instanceId: 'private-instance',
        version: 9,
      })
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

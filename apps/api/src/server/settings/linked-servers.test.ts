import { describe, expect, it } from 'vite-plus/test'
import { normalizeLinkedServer, readLinkedServers, verifyLinkedServer, writeLinkedServers } from './linked-servers.ts'

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
})

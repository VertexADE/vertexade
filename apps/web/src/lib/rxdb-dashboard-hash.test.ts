import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vite-plus/test'
import { dashboardHash } from './rxdb-dashboard-hash'

describe('dashboardHash', () => {
  it.each(['', 'abc', 'VertexADE ⚡'])('matches the native SHA-256 hex digest for %j', async (input) => {
    expect(await dashboardHash(input)).toBe(createHash('sha256').update(input).digest('hex'))
  })

  it('hashes raw ArrayBuffer bytes without text conversion', async () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 254, 255])
    expect(await dashboardHash(bytes.buffer)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('hashes Blob bytes without Web Crypto', async () => {
    const bytes = Uint8Array.from([255, 0, 128, 64])
    expect(await dashboardHash(new Blob([bytes]))).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
})

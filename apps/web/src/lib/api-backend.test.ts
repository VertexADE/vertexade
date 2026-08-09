import { describe, expect, it } from 'vite-plus/test'
import { resolveApiBackend, resolveApiBackends } from './api-backend'

describe('resolveApiBackend', () => {
  it('prefers the canonical API environment variable', () => {
    expect(
      resolveApiBackend({
        VERTEXADE_API_URL: 'http://api.internal:4174',
        DASHBOARD_API_URL: 'http://legacy.internal:4174',
      }),
    ).toBe('http://api.internal:4174')
  })

  it('supports the legacy environment variable', () => {
    expect(
      resolveApiBackend({
        DASHBOARD_API_URL: 'http://legacy.internal:4174',
      }),
    ).toBe('http://legacy.internal:4174')
  })

  it('defaults to the side-by-side API service', () => {
    expect(resolveApiBackend({})).toBe('http://127.0.0.1:4174')
  })

  it('parses an ordered multi-backend registry', () => {
    expect(
      resolveApiBackends({
        VERTEXADE_API_URLS: JSON.stringify([
          { id: 'local', label: 'Local', url: 'http://127.0.0.1:4174' },
          { id: 'team', label: 'Team', url: 'https://api.internal/' },
        ]),
      }),
    ).toEqual([
      { id: 'local', label: 'Local', url: 'http://127.0.0.1:4174', namespace: 0, isDefault: true },
      { id: 'team', label: 'Team', url: 'https://api.internal', namespace: 1, isDefault: false },
    ])
  })

  it('supports a comma-separated URL shorthand', () => {
    expect(resolveApiBackends({ VERTEXADE_API_URLS: 'http://one.internal:4174,https://two.internal' })).toEqual([
      { id: 'server-1', label: 'one.internal:4174', url: 'http://one.internal:4174', namespace: 0, isDefault: true },
      { id: 'server-2', label: 'two.internal', url: 'https://two.internal', namespace: 1, isDefault: false },
    ])
  })

  it('rejects duplicate ids', () => {
    expect(() =>
      resolveApiBackends({
        VERTEXADE_API_URLS: JSON.stringify([
          { id: 'same', url: 'http://one.internal' },
          { id: 'same', url: 'http://two.internal' },
        ]),
      }),
    ).toThrow('Duplicate backend id')
  })
})

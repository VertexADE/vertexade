import { describe, expect, it } from 'vite-plus/test'
import { normalizeServerListenerConfiguration, serverListenerConfigurationPath } from './listener-configuration.ts'

describe('server listener configuration', () => {
  it('normalizes independently configurable web and API listeners', () => {
    expect(
      normalizeServerListenerConfiguration({
        web: { host: '0.0.0.0', port: 8080 },
        api: { host: '::', port: 8081 },
      }),
    ).toEqual({
      web: { host: '0.0.0.0', port: 8080 },
      api: { host: '::', port: 8081 },
    })
  })

  it('rejects URLs, invalid ports, unknown settings, and port conflicts', () => {
    expect(() =>
      normalizeServerListenerConfiguration({ web: { host: 'https://example.com', port: 4173 }, api: { host: '127.0.0.1', port: 4174 } }),
    ).toThrow('without a protocol or port')
    expect(() =>
      normalizeServerListenerConfiguration({ web: { host: 'localhost', port: 0 }, api: { host: 'localhost', port: 4174 } }),
    ).toThrow('integer from 1 to 65535')
    expect(() =>
      normalizeServerListenerConfiguration({ web: { host: 'localhost', port: 4173 }, api: { host: 'localhost', port: 4173 } }),
    ).toThrow('different ports')
  })

  it('uses an explicit configuration path before the data directory', () => {
    expect(serverListenerConfigurationPath({ VERTEXADE_SERVER_CONFIG_PATH: '/tmp/vertexade-runtime.json' })).toBe(
      '/tmp/vertexade-runtime.json',
    )
  })
})

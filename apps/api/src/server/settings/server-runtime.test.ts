import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serverRuntimeStatus, updateServerRuntimeConfiguration, webListenerOrigins } from './server-runtime.ts'

describe('server runtime settings', () => {
  let directory = ''

  afterEach(async () => {
    vi.unstubAllEnvs()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('persists restart-bound listener settings and reports current values', async () => {
    directory = await mkdtemp(join(tmpdir(), 'vertexade-runtime-'))
    const environment = {
      VERTEXADE_DATA_DIR: directory,
      API_HOST: '127.0.0.1',
      API_PORT: '4174',
      VERTEXADE_API_LISTENER_SOURCE: 'settings',
      VERTEXADE_WEB_CURRENT_HOST: '127.0.0.1',
      VERTEXADE_WEB_CURRENT_PORT: '4173',
      VERTEXADE_WEB_LISTENER_SOURCE: 'settings',
    }
    const result = await updateServerRuntimeConfiguration(
      { web: { host: '0.0.0.0', port: 8080 }, api: { host: '0.0.0.0', port: 8081 } },
      environment,
    )

    expect(result.restartRequired).toBe(true)
    expect(result.web).toMatchObject({ host: '0.0.0.0', port: 8080, currentHost: '127.0.0.1', currentPort: 4173 })
    expect(JSON.parse(await readFile(join(directory, 'server-runtime.json'), 'utf8'))).toEqual({
      web: { host: '0.0.0.0', port: 8080 },
      api: { host: '0.0.0.0', port: 8081 },
    })
  })

  it('reports environment-owned listeners without pretending a saved value is active', async () => {
    directory = await mkdtemp(join(tmpdir(), 'vertexade-runtime-'))
    const result = await serverRuntimeStatus({
      VERTEXADE_DATA_DIR: directory,
      HOST: '0.0.0.0',
      PORT: '9000',
      API_HOST: '127.0.0.1',
      API_PORT: '9001',
    })
    expect(result.web).toMatchObject({ currentHost: '0.0.0.0', currentPort: 9000, source: 'environment', environmentOverride: true })
    expect(result.api).toMatchObject({ source: 'environment', environmentOverride: true })
    expect(result.restartRequired).toBe(false)
  })

  it('suggests full phone-reachable origins for wildcard web listeners', () => {
    const origins = webListenerOrigins(
      { host: '0.0.0.0', port: 3773 },
      {
        lo0: [
          { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' },
        ],
        en0: [
          {
            address: '192.168.1.20',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:01',
            internal: false,
            cidr: '192.168.1.20/24',
          },
        ],
        tailscale0: [
          {
            address: '100.101.138.108',
            netmask: '255.192.0.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:02',
            internal: false,
            cidr: '100.101.138.108/10',
          },
        ],
      },
    )

    expect(origins).toEqual(['http://100.101.138.108:3773', 'http://192.168.1.20:3773'])
  })

  it('keeps the bundled desktop API on loopback while allowing its authenticated web gateway to be shared', async () => {
    directory = await mkdtemp(join(tmpdir(), 'vertexade-runtime-'))
    await expect(
      updateServerRuntimeConfiguration(
        { web: { host: '0.0.0.0', port: 3773 }, api: { host: '0.0.0.0', port: 4174 } },
        { VERTEXADE_DATA_DIR: directory, VERTEXADE_BUNDLED_RUNTIME: '1' },
      ),
    ).rejects.toThrow('keeps the API listener on loopback')

    await expect(
      updateServerRuntimeConfiguration(
        { web: { host: '0.0.0.0', port: 3773 }, api: { host: '127.0.0.1', port: 4174 } },
        { VERTEXADE_DATA_DIR: directory, VERTEXADE_BUNDLED_RUNTIME: '1' },
      ),
    ).resolves.toMatchObject({ web: { host: '0.0.0.0', port: 3773 }, api: { host: '127.0.0.1', port: 4174 } })
  })
})

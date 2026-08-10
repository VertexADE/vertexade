import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serverRuntimeStatus, updateServerRuntimeConfiguration } from './server-runtime.ts'

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
})

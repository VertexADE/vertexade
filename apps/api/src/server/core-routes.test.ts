import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vite-plus/test'
import { drizzleDashboardDatabase } from './database/dashboard-database.ts'
import { createCoreRoutes, type CoreRouteDependencies } from './core-routes.ts'
import { defaultSystemConfiguration } from './settings/system-configuration.ts'

function dependencies(overrides: Partial<CoreRouteDependencies> = {}): CoreRouteDependencies {
  const database = drizzleDashboardDatabase(new DatabaseSync(':memory:'))
  return {
    database,
    deploymentRecordPath: '/missing/deployment.json',
    promptImagesDirectory: '/missing/prompt-images',
    systemConfiguration: {
      read: vi.fn(() => defaultSystemConfiguration),
      write: vi.fn(() => defaultSystemConfiguration),
    },
    workspacePreviews: {
      read: vi.fn(() => ({ domain: '', gatewayPort: 4180 })),
      write: vi.fn(async () => ({ domain: '', gatewayPort: 4180 })),
    },
    json: (status, value) => Response.json(value, { status }),
    readBody: vi.fn(async () => ({})),
    notify: vi.fn(),
    setup: {
      run: vi.fn(async () => '1.0.0'),
      selectedScm: () => ({ id: 'github', name: 'GitHub' }),
      extensions: () => [],
      agents: () => [],
    },
    ...overrides,
  }
}

describe('core API routes', () => {
  it('handles liveness and leaves unrelated routes for the next router', async () => {
    const routes = createCoreRoutes(dependencies())
    const live = await routes(new Request('http://localhost/api/health/live'), new URL('http://localhost/api/health/live'))

    expect(live?.status).toBe(200)
    expect(live?.headers.get('cache-control')).toBe('no-store')
    expect(await live?.json()).toMatchObject({ status: 'ok' })
    expect(await routes(new Request('http://localhost/api/other'), new URL('http://localhost/api/other'))).toBeNull()
  })

  it('owns system configuration reads and writes', async () => {
    const notify = vi.fn()
    const systemConfiguration = {
      read: vi.fn(() => ({
        ...defaultSystemConfiguration,
        prompts: { ...defaultSystemConfiguration.prompts, review: 'Carefully' },
      })),
      write: vi.fn(() => ({
        ...defaultSystemConfiguration,
        runtime: { ...defaultSystemConfiguration.runtime, retryAttempts: 2 },
      })),
    }
    const routes = createCoreRoutes(
      dependencies({
        notify,
        systemConfiguration,
        readBody: vi.fn(async () => ({ runtime: { retryAttempts: 2 } })),
      }),
    )
    const url = new URL('http://localhost/api/settings/system-configuration')

    const read = await routes(new Request(url), url)
    expect(await read?.json()).toMatchObject({ prompts: { review: 'Carefully' } })

    const write = await routes(new Request(url, { method: 'POST' }), url)
    expect(await write?.json()).toMatchObject({ runtime: { retryAttempts: 2 } })
    expect(systemConfiguration.write).toHaveBeenCalledWith({ runtime: { retryAttempts: 2 } })
    expect(notify).toHaveBeenCalledWith('system_configuration_updated')
  })

  it('owns worktree preview settings reads and validated writes', async () => {
    const workspacePreviews = {
      read: vi.fn(() => ({ domain: 'previews.example.com', gatewayPort: 4180 })),
      write: vi.fn(async () => ({ domain: 'agents.example.com', gatewayPort: 4280 })),
    }
    const routes = createCoreRoutes(
      dependencies({
        workspacePreviews,
        readBody: vi.fn(async () => ({ domain: 'agents.example.com', gatewayPort: 4280 })),
      }),
    )
    const url = new URL('http://localhost/api/settings/worktree-previews')

    const read = await routes(new Request(url), url)
    expect(await read?.json()).toEqual({ domain: 'previews.example.com', gatewayPort: 4180 })

    const write = await routes(new Request(url, { method: 'POST' }), url)
    expect(await write?.json()).toEqual({ domain: 'agents.example.com', gatewayPort: 4280 })
    expect(workspacePreviews.write).toHaveBeenCalledWith({
      domain: 'agents.example.com',
      gatewayPort: 4280,
    })
  })

  it('keeps typed Effect failures behind the existing core HTTP contract', async () => {
    const routes = createCoreRoutes(
      dependencies({
        systemConfiguration: {
          read: vi.fn(() => defaultSystemConfiguration),
          write: vi.fn(() => {
            throw new Error('Retry attempts must be between 0 and 5')
          }),
        },
        readBody: vi.fn(async () => ({ runtime: { retryAttempts: 99 } })),
      }),
    )
    const url = new URL('http://localhost/api/settings/system-configuration')
    const response = await routes(new Request(url, { method: 'POST' }), url)

    expect(response?.status).toBe(400)
    await expect(response?.json()).resolves.toEqual({
      error: 'Retry attempts must be between 0 and 5',
    })
  })

  it('rejects empty prompt image uploads before touching the filesystem', async () => {
    const routes = createCoreRoutes(dependencies())
    const url = new URL('http://localhost/api/prompt-images')
    const response = await routes(new Request(url, { method: 'POST' }), url)

    expect(response?.status).toBe(400)
    expect(await response?.json()).toEqual({ error: 'Paste or attach at least one image' })
  })
})

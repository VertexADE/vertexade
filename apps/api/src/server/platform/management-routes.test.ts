import { describe, expect, it, vi } from 'vite-plus/test'
import { PLATFORM_API_VERSION } from '@vertexade/platform-contracts'
import { createPlatformClient } from '@vertexade/platform-client'
import { ExtensionRegistry } from '../extensions/registry.ts'
import { createPlatformManagementRoutes } from './management-routes.ts'
import { ExtensionCacheStore } from '../extensions/cache.ts'

function settings() {
  const values = new Map<string, unknown>()
  return {
    read: <T>(name: string, fallback: T) => (values.has(name) ? (values.get(name) as T) : fallback),
    write: (name: string, value: unknown) => {
      values.set(name, value)
    },
    delete: (name: string) => {
      values.delete(name)
    },
    has: (name: string) => values.has(name),
  }
}

async function fixture(
  toggleExtension = vi.fn(async (id: string, enabled: boolean) => ({
    ok: true,
    id,
    desiredEnabled: enabled,
    appliedEnabled: enabled,
    pending: false,
    error: null,
  })),
) {
  const extensions = new ExtensionRegistry().install(
    {
      manifest: {
        id: 'example',
        name: 'Example',
        version: '1.0.0',
        platformApi: PLATFORM_API_VERSION,
        kind: 'other',
        agents: [{ id: 'example-agent', name: 'Example Agent' }],
        providers: [
          { id: 'github', name: 'GitHub', kind: 'scm' },
          { id: 'gitlab', name: 'GitLab', kind: 'scm' },
        ],
      },
      register: ({ agents, providers }) => {
        agents.register({
          id: 'example-agent',
          name: 'Example Agent',
          enabled: true,
          workspaceRoot: '/tmp/example',
          supportsReadOnlyMode: true,
          launch: () => ({ command: 'example', args: [] }),
          launchOptions: async () => ({
            models: [
              {
                id: 'example-fast',
                name: 'Example Fast',
                default_reasoning_effort: 'low',
                reasoning_efforts: [{ id: 'low' }, { id: 'high' }],
              },
            ],
          }),
        })
        providers.register('scm', { id: 'github', name: 'GitHub' })
        providers.register('scm', { id: 'gitlab', name: 'GitLab' })
      },
    },
    { enabled: true },
  )
  await extensions.register('example')
  const encryptedSettings = settings()
  const notify = vi.fn()
  const generateWorkItemTitle = vi.fn(async () => 'Make checkout failures actionable')
  const cache = new ExtensionCacheStore()
  const routes = createPlatformManagementRoutes({
    extensions,
    agents: extensions.agents,
    encryptedSettings,
    cache,
    defaultAgentId: () => 'example-agent',
    extensionEnabled: () => true,
    toggleExtension,
    notify,
    generateWorkItemTitle,
  })
  return { routes, notify, cache, generateWorkItemTitle, toggleExtension }
}

describe('platform management routes', () => {
  it('serves module and capability metadata through the typed router', async () => {
    const { routes } = await fixture()
    const modules = await routes.dispatch(new Request('http://localhost/api/modules'), {})
    const capabilities = await routes.dispatch(new Request('http://localhost/api/capabilities'), {})

    await expect(modules?.json()).resolves.toMatchObject({
      platformApi: PLATFORM_API_VERSION,
      modules: [{ id: 'example' }],
    })
    await expect(capabilities?.json()).resolves.toMatchObject({
      agent_provider: 'example-agent',
      agents: [{ id: 'example-agent' }],
      scm_providers: ['github', 'gitlab'],
    })
  })

  it('protects the active agent extension from being disabled', async () => {
    const { routes, notify } = await fixture()
    const response = await routes.dispatch(
      new Request('http://localhost/api/settings/extensions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'example', enabled: false }),
      }),
      {},
    )

    expect(response?.status).toBe(400)
    await expect(response?.json()).resolves.toEqual({
      error: 'The active default agent extension cannot be disabled',
    })
    expect(notify).not.toHaveBeenCalled()
  })

  it('returns the observed extension state when a durable transition needs repair', async () => {
    const toggleExtension = vi.fn(async (id: string) => ({
      ok: false,
      id,
      desiredEnabled: true,
      appliedEnabled: false,
      pending: true,
      error: 'initialize failed',
    }))
    const { routes } = await fixture(toggleExtension)
    const response = await routes.dispatch(
      new Request('http://localhost/api/settings/extensions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'example', enabled: true }),
      }),
      {},
    )

    expect(response?.status).toBe(409)
    await expect(response?.json()).resolves.toEqual({
      id: 'example',
      enabled: false,
      desiredEnabled: true,
      pending: true,
      error: 'initialize failed',
    })
  })

  it('does not expose provider-aspect routing as a configurable setting', async () => {
    const { routes } = await fixture()
    expect(await routes.dispatch(new Request('http://localhost/api/settings/providers'), {})).toBeNull()
  })

  it('persists provider and model defaults while fixing content generation to read-only', async () => {
    const { routes, notify } = await fixture()
    const endpoint = 'http://localhost/api/settings/content-generation'

    const initial = await routes.dispatch(new Request(endpoint), {})
    await expect(initial?.json()).resolves.toEqual({
      agentId: 'example-agent',
      model: '',
      reasoningEffort: '',
      serviceTier: '',
      permissionMode: 'read-only',
    })

    const saved = await routes.dispatch(
      new Request(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: 'example-agent',
          model: 'example-fast',
          reasoningEffort: 'high',
          serviceTier: '',
        }),
      }),
      {},
    )
    await expect(saved?.json()).resolves.toEqual({
      agentId: 'example-agent',
      model: 'example-fast',
      reasoningEffort: 'high',
      serviceTier: '',
      permissionMode: 'read-only',
    })
    expect(notify).toHaveBeenCalledWith('content_generation_settings_updated')

    const persisted = await routes.dispatch(new Request(endpoint), {})
    await expect(persisted?.json()).resolves.toMatchObject({
      model: 'example-fast',
      reasoningEffort: 'high',
    })
  })

  it('rejects unavailable models and attempts to override read-only generation', async () => {
    const { routes } = await fixture()
    const endpoint = 'http://localhost/api/settings/content-generation'
    const request = (body: Record<string, unknown>) =>
      routes.dispatch(
        new Request(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        {},
      )

    const invalidModel = await request({
      agentId: 'example-agent',
      model: 'missing',
      reasoningEffort: '',
    })
    expect(invalidModel?.status).toBe(400)
    await expect(invalidModel?.json()).resolves.toEqual({
      error: 'Model is not available for Example Agent',
    })

    const elevated = await request({
      agentId: 'example-agent',
      model: '',
      reasoningEffort: '',
      permissionMode: 'full',
    })
    expect(elevated?.status).toBe(400)
    await expect(elevated?.json()).resolves.toEqual({
      error: 'Unknown content generation setting: permissionMode',
    })
  })

  it('generates a Work item title with the persisted read-only defaults', async () => {
    const { routes, generateWorkItemTitle } = await fixture()
    const response = await routes.dispatch(
      new Request('http://localhost/api/content-generation/work-item-title', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          context: 'Surface failed deployment logs and suggested remediation.',
          kind: 'implementation',
        }),
      }),
      {},
    )

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual({
      title: 'Make checkout failures actionable',
      defaults: {
        agentId: 'example-agent',
        model: '',
        reasoningEffort: '',
        serviceTier: '',
        permissionMode: 'read-only',
      },
    })
    expect(generateWorkItemTitle).toHaveBeenCalledWith(
      {
        context: 'Surface failed deployment logs and suggested remediation.',
        kind: 'implementation',
      },
      { agentId: 'example-agent', model: '', reasoningEffort: '', serviceTier: '', permissionMode: 'read-only' },
    )
  })

  it('reports and clears extension-scoped caches', async () => {
    const { routes, cache, notify } = await fixture()
    await cache.scope('example').getOrLoad('overview', async () => ({ ok: true }), { ttlMs: 1_000 })

    const modules = await routes.dispatch(new Request('http://localhost/api/modules'), {})
    await expect(modules?.json()).resolves.toMatchObject({
      cache: [{ namespace: 'example', entries: 1, refreshes: 1 }],
    })
    const cleared = await routes.dispatch(new Request('http://localhost/api/modules/example/cache', { method: 'DELETE' }), {})
    await expect(cleared?.json()).resolves.toMatchObject({
      moduleId: 'example',
      removed: 1,
      stats: { entries: 0 },
    })
    expect(notify).toHaveBeenCalledWith('extension_cache_invalidated')
  })

  it('conforms to the shared web and mobile SDK', async () => {
    const { routes, cache } = await fixture()
    await cache.scope('example').getOrLoad('overview', async () => ({ ok: true }), { ttlMs: 1_000 })
    const client = createPlatformClient({
      baseUrl: 'http://localhost',
      fetch: async (url, init) =>
        (await routes.dispatch(new Request(url, init), {})) || Response.json({ error: 'Not found' }, { status: 404 }),
    })

    await expect(client.modules.list()).resolves.toMatchObject({
      platformApi: PLATFORM_API_VERSION,
      modules: [{ id: 'example' }],
    })
    await expect(client.modules.clearCache('example')).resolves.toMatchObject({
      moduleId: 'example',
      removed: 1,
      stats: { entries: 0 },
    })
  })
})

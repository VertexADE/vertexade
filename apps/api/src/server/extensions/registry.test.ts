import { describe, expect, it, vi } from 'vite-plus/test'
import { PLATFORM_API_VERSION } from '@vertexade/platform-contracts'
import { ExtensionRegistry } from './registry.ts'

const extension = (id = 'example') => ({
  manifest: {
    id,
    name: 'Example',
    version: '1.0.0',
    platformApi: PLATFORM_API_VERSION,
    kind: 'other' as const,
  },
})

describe('ExtensionRegistry', () => {
  it('runs versioned extension migrations exactly once', async () => {
    const applied = new Map<string, number[]>()
    const migrate = vi.fn()
    const registry = new ExtensionRegistry({
      applied: (moduleId) => applied.get(moduleId) || [],
      record(moduleId, version) {
        applied.set(moduleId, [...(applied.get(moduleId) || []), version])
      },
    }).install({
      ...extension(),
      migrations: [{ version: 1, name: 'initialize settings', migrate }],
    })

    await registry.migrate('example')
    await registry.migrate('example')

    expect(migrate).toHaveBeenCalledTimes(1)
    expect(applied.get('example')).toEqual([1])
  })

  it('tracks installation separately from enablement', () => {
    const registry = new ExtensionRegistry().install(extension(), { source: '/extensions/example' })
    expect(registry.capabilities()).toEqual([
      {
        id: 'example',
        name: 'Example',
        version: '1.0.0',
        platformApi: '1',
        kind: 'other',
        installed: true,
        enabled: false,
        source: '/extensions/example',
        installation: { origin: 'local', removable: false },
        lifecycle: 'disabled',
      },
    ])
    expect(() => registry.require('example')).toThrow('Example extension is disabled')
    registry.enable('example', true)
    expect(registry.require('example').manifest.id).toBe('example')
  })

  it('rejects duplicate and malformed manifests', () => {
    const registry = new ExtensionRegistry().install(extension())
    expect(() => registry.install(extension())).toThrow('Extension already installed')
    expect(() => new ExtensionRegistry().install(extension('Not Valid'))).toThrow('kebab-case')
  })

  it('runs enabled lifecycle hooks', async () => {
    const initialize = vi.fn()
    const dispose = vi.fn()
    const registry = new ExtensionRegistry().install({ ...extension(), initialize, dispose }, { enabled: true })
    await registry.initialize()
    await registry.dispose()
    expect(initialize).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('registers scoped backend contributions once', async () => {
    const execute = vi.fn(async () => undefined)
    const register = vi.fn(({ actions }) => actions.register({ id: 'example.run', name: 'Run example', execute }))
    const example = extension()
    const registry = new ExtensionRegistry().install(
      {
        ...example,
        manifest: {
          ...example.manifest,
          contributes: { actions: [{ id: 'example.run', name: 'Run example' }] },
        },
        register,
      },
      { enabled: true },
    )

    await registry.register('example')
    await registry.register('example')

    expect(register).toHaveBeenCalledOnce()
    expect(registry.contributions.actions.require('example.run').moduleId).toBe('example')
  })

  it('registers extension-defined primitives before dependent capabilities', async () => {
    const primitive = extension('ranking')
    const consumer = extension('ranked-tickets')
    const registry = new ExtensionRegistry()
      .install(
        {
          ...consumer,
          manifest: {
            ...consumer.manifest,
            requires: { parts: { primitives: ['rank'] } },
            contributes: { custom: { rank: [{ id: 'tickets.rank', name: 'Rank tickets' }] } },
          },
          register: ({ custom }) =>
            custom.register('rank', {
              id: 'tickets.rank',
              name: 'Rank tickets',
              run: async (input) => input,
            }),
        },
        { enabled: true },
      )
      .install(
        {
          ...primitive,
          manifest: { ...primitive.manifest, primitives: [{ id: 'rank', name: 'Ranking' }] },
          register: ({ primitives }) => primitives.register({ id: 'rank', name: 'Ranking' }),
        },
        { enabled: true },
      )

    await registry.register('ranked-tickets')

    expect(registry.installed('ranking')?.registered).toBe(true)
    expect(registry.contributions.primitive('rank')).toMatchObject({
      moduleId: 'ranking',
      name: 'Ranking',
    })
    expect(registry.contributions.custom('rank')?.require('tickets.rank').moduleId).toBe('ranked-tickets')
    registry.enable('ranking', false)
    expect(() => registry.contributions.requireCustom('rank', 'tickets.rank')).toThrow('ranking module is disabled')
  })

  it('rejects missing and cyclic extension part dependencies', async () => {
    const missing = extension('missing-consumer')
    const missingRegistry = new ExtensionRegistry().install({
      ...missing,
      manifest: { ...missing.manifest, requires: { parts: { primitives: ['absent'] } } },
    })
    await expect(missingRegistry.register('missing-consumer')).rejects.toThrow('requires missing primitive absent')

    const first = extension('first')
    const second = extension('second')
    const cyclicRegistry = new ExtensionRegistry()
      .install({
        ...first,
        manifest: {
          ...first.manifest,
          primitives: [{ id: 'first-kind', name: 'First' }],
          requires: { parts: { primitives: ['second-kind'] } },
        },
        register: ({ primitives }) => primitives.register({ id: 'first-kind', name: 'First' }),
      })
      .install({
        ...second,
        manifest: {
          ...second.manifest,
          primitives: [{ id: 'second-kind', name: 'Second' }],
          requires: { parts: { primitives: ['first-kind'] } },
        },
        register: ({ primitives }) => primitives.register({ id: 'second-kind', name: 'Second' }),
      })
    await expect(cyclicRegistry.register('first')).rejects.toThrow('dependency cycle')
  })

  it('rejects capabilities that drift from the public manifest', async () => {
    const register = ({ actions }) =>
      actions.register({
        id: 'example.hidden',
        name: 'Hidden action',
        execute: async () => undefined,
      })
    const registry = new ExtensionRegistry().install({ ...extension(), register })

    await expect(registry.register('example')).rejects.toThrow('manifest declarations do not match')
    expect(registry.contributions.actions.get('example.hidden')).toBeNull()
  })

  it('matches extension-defined providers against their manifest declarations', async () => {
    const provider = {
      id: 'example-incidents',
      name: 'Example incidents',
      listIncidents: async () => [],
    }
    const base = extension()
    const registry = new ExtensionRegistry().install(
      {
        ...base,
        manifest: {
          ...base.manifest,
          kind: 'incident-management',
          providers: [{ id: provider.id, name: provider.name, kind: 'incident-management' }],
        },
        register: ({ providers }) => providers.register('incident-management', provider),
      },
      { enabled: true },
    )

    await registry.register('example')
    await expect(registry.providers.forKind<typeof provider>('incident-management').require(provider.id).listIncidents()).resolves.toEqual(
      [],
    )
  })

  it('registers extension-owned agents and applies extension enablement', async () => {
    const agent = {
      id: 'example',
      name: 'Example agent',
      enabled: true,
      workspaceRoot: '/tmp/example',
      launch: () => ({ command: 'example', args: [] }),
    }
    const base = extension()
    const registry = new ExtensionRegistry().install({
      ...base,
      manifest: { ...base.manifest, agents: [{ id: agent.id, name: agent.name }] },
      register: ({ agents }) => agents.register(agent),
    })
    await registry.register('example')
    expect(() => registry.agents.require('example')).toThrow('disabled')
    registry.enable('example', true)
    expect(registry.agents.require('example').name).toBe('Example agent')
  })

  it('rejects registered agents that drift from the public manifest', async () => {
    const register = ({ agents }) =>
      agents.register({
        id: 'hidden',
        name: 'Hidden',
        enabled: true,
        workspaceRoot: '/tmp/hidden',
        launch: () => ({ command: 'hidden', args: [] }),
      })
    const registry = new ExtensionRegistry().install({ ...extension(), register })
    await expect(registry.register('example')).rejects.toThrow('agent manifest declarations do not match')
    expect(registry.agents.get('hidden')).toBeNull()
  })

  it('keeps registered API routes unavailable until their module is enabled', async () => {
    const register = ({ routes }) =>
      routes.register({
        method: 'GET',
        path: '/status',
        handler: () => Response.json({ ok: true }),
      })
    const registry = new ExtensionRegistry().install({ ...extension(), register })
    await registry.register('example')

    const disabled = await registry.routes.dispatch(new Request('http://localhost/api/extensions/example/status'))
    expect(disabled?.status).toBe(404)
    registry.enable('example', true)
    const enabled = await registry.routes.dispatch(new Request('http://localhost/api/extensions/example/status'))
    expect(enabled?.status).toBe(200)
  })

  it('publishes a source-free module catalog for the host shell', () => {
    const registry = new ExtensionRegistry().install(
      {
        ...extension(),
        status: () => ({ configured: true, healthy: false, message: 'Authentication expired' }),
      },
      { enabled: true, source: '/private/path/extension.ts' },
    )
    expect(registry.catalog()).toEqual([
      {
        id: 'example',
        name: 'Example',
        version: '1.0.0',
        platformApi: '1',
        kind: 'other',
        installed: true,
        enabled: true,
        installation: { origin: 'local', removable: false },
        lifecycle: 'degraded',
        configured: true,
        healthy: false,
        message: 'Authentication expired',
      },
    ])
  })

  it('normalizes configuration and enablement into catalog lifecycle states', () => {
    const setup = new ExtensionRegistry().install(
      { ...extension('setup'), status: () => ({ configured: false }) },
      { enabled: true, origin: 'bundled' },
    )
    const ready = new ExtensionRegistry().install(
      { ...extension('ready'), status: () => ({ configured: true, healthy: true }) },
      { enabled: true },
    )
    expect(setup.catalog()[0]).toMatchObject({
      lifecycle: 'setup-required',
      installation: { origin: 'bundled', removable: false },
    })
    expect(ready.catalog()[0].lifecycle).toBe('ready')
  })

  it('isolates status failures in the affected catalog entry', async () => {
    const base = extension()
    const registry = new ExtensionRegistry().install(
      {
        ...base,
        manifest: {
          ...base.manifest,
          contributes: { actions: [{ id: 'example.run', name: 'Run example' }] },
        },
        status: () => {
          throw new Error('health probe failed')
        },
        register: ({ actions }) =>
          actions.register({
            id: 'example.run',
            name: 'Run example',
            execute: async () => undefined,
          }),
      },
      { enabled: true },
    )
    await registry.register('example')
    expect(registry.catalog()[0]).toMatchObject({
      lifecycle: 'failed',
      healthy: false,
      message: 'health probe failed',
      failure: { moduleId: 'example', phase: 'status', message: 'health probe failed' },
    })
    expect(registry.diagnostics()).toEqual([{ moduleId: 'example', phase: 'status', message: 'health probe failed' }])
    expect(() => registry.contributions.actions.require('example.run')).toThrow('example module is disabled')
  })

  it('continues initializing healthy extensions after one fails', async () => {
    const healthyInitialize = vi.fn()
    const registry = new ExtensionRegistry()
      .install(
        {
          ...extension('broken'),
          initialize: async () => {
            throw new Error('startup failed')
          },
        },
        { enabled: true },
      )
      .install({ ...extension('healthy'), initialize: healthyInitialize }, { enabled: true })

    await expect(registry.initialize()).resolves.toBeUndefined()
    expect(healthyInitialize).toHaveBeenCalledOnce()
    expect(registry.catalog().find(({ id }) => id === 'broken')).toMatchObject({
      lifecycle: 'failed',
      failure: { phase: 'initialize' },
    })
  })
})

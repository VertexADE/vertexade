import { describe, expect, it, vi } from 'vite-plus/test'
import { PlatformCapabilityRegistries } from './capability-registry.ts'

describe('platform capability registries', () => {
  it('binds capabilities to the registering module', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const registries = new PlatformCapabilityRegistries()

    registries.forModule('sentry').actions.register({
      id: 'findings.remediate',
      name: 'Remediate finding',
      execute,
    })

    const action = registries.actions.require('findings.remediate')
    expect(action.moduleId).toBe('sentry')
    await expect(action.execute({}, { moduleId: action.moduleId })).resolves.toEqual({ ok: true })
  })

  it('prevents duplicate capability ownership', () => {
    const registries = new PlatformCapabilityRegistries()
    const capability = {
      id: 'findings.remediate',
      name: 'Remediate',
      execute: async () => undefined,
    }
    registries.forModule('sentry').actions.register(capability)

    expect(() => registries.forModule('sonarqube').actions.register(capability)).toThrow(
      'action capability already registered: findings.remediate',
    )
  })

  it('does not resolve capabilities from disabled modules', () => {
    const enabled = new Set(['sentry'])
    const registries = new PlatformCapabilityRegistries((moduleId) => enabled.has(moduleId))
    registries.forModule('sentry').gates.register({
      id: 'findings.clear',
      name: 'No blocking findings',
      evaluate: async () => ({ passed: true, summary: 'Clear' }),
    })

    enabled.clear()
    expect(() => registries.gates.require('findings.clear')).toThrow('sentry module is disabled')
  })

  it('removes every contribution owned by an uninstalled module', () => {
    const registries = new PlatformCapabilityRegistries()
    registries.forModule('sentry').evidence.register({
      id: 'sentry.release-health',
      name: 'Release health',
      collect: async () => ({ status: 'passed', summary: 'Healthy' }),
    })

    registries.removeModule('sentry')
    expect(registries.evidence.get('sentry.release-health')).toBeNull()
  })

  it('registers provider-neutral query and transform primitives', async () => {
    const registries = new PlatformCapabilityRegistries()
    registries.forModule('inventory').queries.register({
      id: 'inventory.lookup',
      name: 'Look up inventory',
      query: async (input: { sku: string }) => ({ sku: input.sku, available: 3 }),
    })
    registries.forModule('inventory').transforms.register({
      id: 'inventory.normalize',
      name: 'Normalize inventory',
      transform: async (input: { sku: string }) => ({ sku: input.sku.trim().toUpperCase() }),
    })

    await expect(registries.queries.require('inventory.lookup').query({ sku: 'abc' }, { moduleId: 'inventory' })).resolves.toEqual({
      sku: 'abc',
      available: 3,
    })
    await expect(
      registries.transforms.require('inventory.normalize').transform({ sku: ' abc ' }, { moduleId: 'inventory' }),
    ).resolves.toEqual({ sku: 'ABC' })
    expect(registries.declarations('inventory')).toMatchObject({
      queries: ['inventory.lookup'],
      transforms: ['inventory.normalize'],
    })
  })
})

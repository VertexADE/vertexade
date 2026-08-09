import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import { CapabilityExecutionService, validateCapabilityValue } from './capability-execution.ts'

const databases: Array<{ close(): void }> = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
  const database = openDashboardDatabase(':memory:')
  databases.push(database)
  const registries = new PlatformCapabilityRegistries()
  const notify = vi.fn()
  return {
    database,
    registries,
    notify,
    service: new CapabilityExecutionService(database, registries, notify),
  }
}

describe('capability execution service', () => {
  it('validates input and persists successful output', async () => {
    const { registries, service, notify } = fixture()
    registries.forModule('example').actions.register({
      id: 'example.echo',
      name: 'Echo',
      inputSchema: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string', minLength: 1 } },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string' } },
      },
      execute: async (input: { message: string }) => input,
    })

    const result = await service.execute('action', 'example.echo', { message: 'hello' })

    expect(result).toMatchObject({
      status: 'succeeded',
      input: { message: 'hello' },
      output: { message: 'hello' },
      attempts: 1,
    })
    expect(notify).toHaveBeenCalledWith('capability_execution_succeeded', result.id)
    await expect(service.execute('action', 'example.echo', { message: '', extra: true })).rejects.toThrow('is too short')
  })

  it('retries failures and returns an idempotent execution', async () => {
    const { registries, service } = fixture()
    let attempts = 0
    registries.forModule('example').actions.register({
      id: 'example.retry',
      name: 'Retry',
      retry: { attempts: 2, delayMs: 0 },
      execute: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('temporary')
        return { ok: true }
      },
    })

    const first = await service.execute('action', 'example.retry', {}, { idempotencyKey: 'same-request' })
    const second = await service.execute('action', 'example.retry', {}, { idempotencyKey: 'same-request' })

    expect(first).toMatchObject({ status: 'succeeded', attempts: 2 })
    expect(second.id).toBe(first.id)
    expect(attempts).toBe(2)
  })

  it('re-executes a terminal failed idempotent action', async () => {
    const { registries, service } = fixture()
    let invocations = 0
    registries.forModule('example').actions.register({
      id: 'example.transient',
      name: 'Transient action',
      execute: async () => {
        invocations += 1
        if (invocations === 1) throw new Error('temporary provider failure')
        return { ok: true }
      },
    })

    const failed = await service.execute('action', 'example.transient', {}, { idempotencyKey: 'same-revision' })
    const retried = await service.execute('action', 'example.transient', {}, { idempotencyKey: 'same-revision' })

    expect(failed).toMatchObject({ status: 'failed', attempts: 1 })
    expect(retried).toMatchObject({
      id: failed.id,
      status: 'succeeded',
      attempts: 1,
      output: { ok: true },
    })
    expect(invocations).toBe(2)
  })

  it('uses configured runtime defaults when a capability does not override them', async () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const registries = new PlatformCapabilityRegistries()
    let attempts = 0
    const service = new CapabilityExecutionService(database, registries, undefined, () => ({
      capabilityTimeoutMs: 500,
      retryAttempts: 3,
      retryDelayMs: 0,
    }))
    registries.forModule('example').actions.register({
      id: 'example.configured-retry',
      name: 'Configured retry',
      execute: async () => {
        attempts += 1
        if (attempts < 3) throw new Error('temporary')
        return { ok: true }
      },
    })

    await expect(service.execute('action', 'example.configured-retry', {})).resolves.toMatchObject({
      status: 'succeeded',
      attempts: 3,
      maxAttempts: 3,
    })
  })

  it('records gate failures as successful evaluations', async () => {
    const { registries, service } = fixture()
    registries.forModule('quality').gates.register({
      id: 'quality.coverage',
      name: 'Coverage',
      evaluate: async () => ({ passed: false, summary: 'Coverage is below the threshold' }),
    })

    await expect(service.execute('gate', 'quality.coverage', null)).resolves.toMatchObject({
      status: 'succeeded',
      output: { passed: false, summary: 'Coverage is below the threshold' },
    })
  })

  it('durably executes query and transform primitives', async () => {
    const { registries, service } = fixture()
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

    await expect(service.execute('query', 'inventory.lookup', { sku: 'abc' })).resolves.toMatchObject({
      capabilityKind: 'query',
      status: 'succeeded',
      output: { sku: 'abc', available: 3 },
    })
    await expect(service.execute('transform', 'inventory.normalize', { sku: ' abc ' })).resolves.toMatchObject({
      capabilityKind: 'transform',
      status: 'succeeded',
      output: { sku: 'ABC' },
    })
  })

  it('durably executes extension-defined primitives', async () => {
    const { registries, service } = fixture()
    registries.registerPrimitive('ranking', { id: 'rank', name: 'Ranking' })
    registries.forModule('tickets').custom.register('rank', {
      id: 'tickets.rank',
      name: 'Rank tickets',
      run: async (input: { scores: number[] }) => [...input.scores].sort((left, right) => right - left),
    })

    await expect(service.execute('rank', 'tickets.rank', { scores: [2, 9, 4] })).resolves.toMatchObject({
      capabilityKind: 'rank',
      moduleId: 'tickets',
      status: 'succeeded',
      output: [9, 4, 2],
    })
  })

  it('times out capabilities that ignore cancellation', async () => {
    const { registries, service } = fixture()
    registries.forModule('example').actions.register({
      id: 'example.stuck',
      name: 'Stuck',
      timeoutMs: 100,
      execute: () => new Promise(() => {}),
    })

    await expect(service.execute('action', 'example.stuck', null)).resolves.toMatchObject({
      status: 'timed-out',
      attempts: 1,
    })
  })
})

describe('capability schema validation', () => {
  it('checks nested arrays and required properties', () => {
    expect(() =>
      validateCapabilityValue(
        { values: [1, 2] },
        {
          type: 'object',
          required: ['values'],
          properties: { values: { type: 'array', items: { type: 'integer', minimum: 1 } } },
        },
      ),
    ).not.toThrow()
    expect(() =>
      validateCapabilityValue(
        { values: [0] },
        {
          type: 'object',
          required: ['values'],
          properties: { values: { type: 'array', items: { type: 'integer', minimum: 1 } } },
        },
      ),
    ).toThrow('$.values[0] is below the minimum')
  })
})

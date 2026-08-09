import { describe, expect, it } from 'vite-plus/test'
import type { CrossWorktreeFollowUpInput, ExtensionHostServices } from '@vertexade/platform-contracts'
import { createScopedExtensionContext } from './scoped-context.ts'
import { ExtensionCacheStore } from './cache.ts'

const followUpInput: CrossWorktreeFollowUpInput = {
  sourceJobId: 1,
  destinationJobId: 2,
  title: 'Follow-up',
  instruction: 'Continue the work',
}
const workItem = {
  id: 1,
  key: 'W-0001',
  title: 'Follow-up',
  description: '',
  kind: 'implementation' as const,
  state: 'active' as const,
  priority: 'normal' as const,
}

function host(): ExtensionHostServices {
  const settings = new Map<string, unknown>()
  return {
    settings: {
      read: <T>(name: string, fallback: T) => (settings.has(name) ? (settings.get(name) as T) : fallback),
      write: (name: string, value: unknown) => {
        settings.set(name, value)
      },
      delete: (name: string) => {
        settings.delete(name)
      },
      has: (name: string) => settings.has(name),
    },
    repositories: { get: () => null, list: () => [] },
    tasks: {
      launch: async () => ({}),
      followUpInWorktree: async () => ({
        workItem,
        destinationJobId: 2,
        transferId: 1,
        status: 'running',
      }),
    },
    work: {
      create: () => workItem,
      linkResource: () => ({}),
      relate: () => undefined,
      memory: async (workItemId) => ({
        workItemId,
        key: workItem.key,
        path: '/data/memory.md',
        content: 'shared',
        updatedAt: '2026-07-20T00:00:00.000Z',
      }),
      writeMemory: async (workItemId) => ({
        workItemId,
        key: workItem.key,
        path: '/data/memory.md',
        content: 'updated',
        updatedAt: '2026-07-20T00:00:00.000Z',
      }),
    },
    events: { emit: () => undefined },
    network: { fetch: async () => Response.json({ ok: true }) },
  }
}

describe('scoped extension context', () => {
  it('namespaces settings and enforces declared permissions', () => {
    const base = host()
    const scoped = createScopedExtensionContext('sentry', { host: base })
    scoped.setPermissions(['settings.read', 'settings.write'])
    scoped.context.host.settings.write('config', { token: 'secret' })
    expect(base.settings.has('extension:sentry:config')).toBe(true)
    expect(scoped.context.host.settings.read('config', null)).toEqual({ token: 'secret' })
    expect(() => scoped.context.host.repositories.list()).toThrow('undeclared permission repositories.read')
  })

  it('guards command execution separately from host services', async () => {
    const scoped = createScopedExtensionContext('github', { host: host(), run: async () => 'ok' })
    expect(() => scoped.context.run('gh', ['--version'])).toThrow('undeclared permission process.execute')
    scoped.setPermissions(['process.execute'])
    await expect(scoped.context.run('gh', ['--version'])).resolves.toBe('ok')
  })

  it('guards SCM authentication independently from other host services', () => {
    const base = host()
    base.scmAuthentication = {
      state: () => ({ source: 'test', connected: true, error: '', expiresAt: null }),
      useToken: () => undefined,
      restore: () => undefined,
      clearCachedUser: () => undefined,
      fail: () => undefined,
    }
    const scoped = createScopedExtensionContext('scm', { host: base })
    expect(() => scoped.context.host.scmAuthentication?.restore()).toThrow('undeclared permission scm-auth.manage')
    scoped.setPermissions(['scm-auth.manage'])
    expect(() => scoped.context.host.scmAuthentication?.restore()).not.toThrow()
  })

  it('requires an explicit permission for outbound network requests', async () => {
    const scoped = createScopedExtensionContext('networked', { host: host() })
    expect(() => scoped.context.host.network?.fetch('https://example.com')).toThrow('undeclared permission network.request')
    scoped.setPermissions(['network.request'])
    await expect(scoped.context.host.network?.fetch('https://example.com')).resolves.toBeInstanceOf(Response)
  })

  it('requires the dedicated permission for cross-worktree follow-ups', async () => {
    const scoped = createScopedExtensionContext('handoff', { host: host() })
    expect(() => scoped.context.host.tasks.followUpInWorktree(followUpInput)).toThrow('undeclared permission tasks.follow-up')
    scoped.setPermissions(['tasks.follow-up'])
    await expect(scoped.context.host.tasks.followUpInWorktree(followUpInput)).resolves.toEqual({
      workItem,
      destinationJobId: 2,
      transferId: 1,
      status: 'running',
    })
  })

  it('separates shared memory reads from Work mutations', async () => {
    const scoped = createScopedExtensionContext('memory-reader', { host: host() })
    scoped.setPermissions(['work.read'])
    await expect(scoped.context.host.work.memory(1)).resolves.toMatchObject({
      workItemId: 1,
      content: 'shared',
    })
    expect(() => scoped.context.host.work.writeMemory(1, 'updated')).toThrow('undeclared permission work.write')
  })

  it('scopes caches and enforces independent read and write permissions', async () => {
    const base = host()
    base.cache = new ExtensionCacheStore()
    const left = createScopedExtensionContext('left', { host: base })
    const right = createScopedExtensionContext('right', { host: base })
    left.setPermissions(['cache.read', 'cache.write'])
    right.setPermissions(['cache.read'])

    await left.context.host.cache?.getOrLoad('board', async () => 'left', { ttlMs: 1_000 })
    await right.context.host.cache?.getOrLoad('board', async () => 'right', { ttlMs: 1_000 })
    expect(left.context.host.cache?.stats()).toMatchObject({ namespace: 'left', entries: 1 })
    expect(right.context.host.cache?.stats()).toMatchObject({ namespace: 'right', entries: 1 })
    expect(() => right.context.host.cache?.invalidate()).toThrow('right extension requires undeclared permission cache.write')
  })
})

import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { ActionCapability } from '@vertexade/platform-contracts'
import { createExtension } from './extension.ts'

const githubAppKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

function host(config = { active: false, appId: '', installationId: '', privateKey: '' }) {
  return {
    settings: {
      read: () => config,
      write: vi.fn(),
      delete: vi.fn(),
    },
    scmAuthentication: {
      restore: vi.fn(),
      state: () => ({ source: 'test', connected: true, error: '', expiresAt: null }),
      useToken: vi.fn(),
      fail: vi.fn(),
      clearCachedUser: vi.fn(),
    },
    cache: { invalidate: vi.fn() },
    events: { emit: vi.fn() },
  }
}

async function registeredActions(extension: ReturnType<typeof createExtension>) {
  const actions = new Map<string, ActionCapability>()
  await extension.register?.({
    actions: {
      register: (action) => {
        actions.set(action.id, action)
      },
    },
    queries: { register: vi.fn() },
    transforms: { register: vi.fn() },
    gates: { register: vi.fn() },
    evidence: { register: vi.fn() },
    triggers: { register: vi.fn() },
    custom: { register: vi.fn() },
    providers: {
      register: vi.fn(),
      scm: { register: vi.fn() },
      workManagement: { register: vi.fn() },
      records: { register: vi.fn() },
      findings: { register: vi.fn() },
      deployment: { register: vi.fn() },
      workReferences: { register: vi.fn() },
      inbox: { register: vi.fn() },
      search: { register: vi.fn() },
    },
    primitives: { register: vi.fn() },
    agents: { register: vi.fn(), unregister: vi.fn() },
    routes: { register: vi.fn() },
  })
  return actions
}

async function registeredSurface(extension: ReturnType<typeof createExtension>) {
  const actions: string[] = []
  const routes: string[] = []
  const providers: string[] = []
  await extension.register?.({
    actions: { register: (action) => actions.push(action.id) },
    queries: { register: vi.fn() },
    transforms: { register: vi.fn() },
    gates: { register: vi.fn() },
    evidence: { register: vi.fn() },
    triggers: { register: vi.fn() },
    custom: { register: vi.fn() },
    providers: {
      register: vi.fn(),
      scm: { register: (provider) => providers.push(`scm:${provider.id}`) },
      workManagement: { register: vi.fn() },
      records: { register: vi.fn() },
      findings: { register: vi.fn() },
      deployment: { register: (provider) => providers.push(`deployment:${provider.id}`) },
      workReferences: { register: vi.fn() },
      inbox: { register: vi.fn() },
      search: { register: vi.fn() },
    },
    primitives: { register: vi.fn() },
    agents: { register: vi.fn(), unregister: vi.fn() },
    routes: { register: (route) => routes.push(`${route.method} ${route.path}`) },
  })
  return { actions, routes, providers }
}

describe('GitHub contextual actions', () => {
  it('keeps the provider, action, and settings route inventory stable', async () => {
    const surface = await registeredSurface(createExtension({ run: vi.fn(), host: host() as never }))

    expect(surface.providers).toEqual(['scm:github', 'deployment:github-actions'])
    expect(surface.actions).toEqual(['github.approve', 'github.approve-auto-merge', 'github.request-changes', 'github.comment-review'])
    expect(surface.routes).toEqual(['GET /settings', 'POST /settings', 'DELETE /settings'])
  })

  it('aborts a pending exchange and restores the original process token on disposal', async () => {
    const previous = process.env.GH_TOKEN
    process.env.GH_TOKEN = 'original-token'
    let exchangeAborted = false
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              exchangeAborted = true
              reject(new Error('aborted', { cause: init.signal?.reason }))
            },
            { once: true },
          )
        }),
    )
    try {
      const extension = createExtension({
        run: vi.fn(),
        host: host({ active: true, appId: '123', installationId: '456', privateKey: githubAppKey }) as never,
        fetch: fetchImpl,
      })

      await extension.initialize?.()
      expect(process.env.GH_TOKEN).toBe('github-app-authentication-pending')
      await extension.dispose?.()

      expect(exchangeAborted).toBe(true)
      expect(process.env.GH_TOKEN).toBe('original-token')
    } finally {
      if (previous === undefined) delete process.env.GH_TOKEN
      else process.env.GH_TOKEN = previous
    }
  })

  it('does not block extension initialization on a pending GitHub App exchange', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted', { cause: init.signal?.reason })), { once: true })
        }),
    )
    const extension = createExtension({
      run: vi.fn(),
      host: host({ active: true, appId: '123', installationId: '456', privateKey: githubAppKey }) as never,
      fetch: fetchImpl,
    })

    await expect(extension.initialize?.()).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(extension.status?.()).toMatchObject({
      healthy: false,
      message: 'GitHub App authentication is initializing',
    })

    await extension.dispose?.()
  })

  it('recovers a failed background authentication on the refresh timer', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockImplementation(() =>
        Promise.resolve(Response.json({ token: 'installation-token', expires_at: '2030-01-01T00:00:00Z' }, { status: 201 })),
      )
    const extension = createExtension({
      run: vi.fn(),
      host: host({ active: true, appId: '123', installationId: '456', privateKey: githubAppKey }) as never,
      fetch: fetchImpl,
      authenticationRefreshMs: 200,
    })

    await extension.initialize?.()
    await vi.waitFor(() => expect(extension.status?.()).toMatchObject({ configured: true, healthy: true }))

    await extension.dispose?.()
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('uses one approval policy for every approval presentation', () => {
    const actions = createExtension({ run: vi.fn(), host: host() as never }).manifest.ui?.contextualActions || []
    const approvals = actions.filter((action) => action.capabilityId.startsWith('github.approve'))

    expect(approvals).toHaveLength(2)
    for (const action of approvals) {
      expect(action.conditions).toContainEqual(
        expect.objectContaining({
          field: 'checks_failed',
          operator: 'equals',
          value: 0,
        }),
      )
    }
  })

  it('exposes a focused human-review surface with visible eligibility rules', () => {
    const actions = createExtension({ run: vi.fn(), host: host() as never }).manifest.ui?.contextualActions || []
    const reviewActions = actions.filter((action) => action.placements.includes('pull-request.review'))

    expect(reviewActions.map((action) => action.id)).toEqual([
      'github.approve-pr',
      'github.request-pr-changes',
      'github.comment-on-pr-review',
    ])
    expect(actions.find((action) => action.id === 'github.approve-pr')?.inputFields).toContainEqual(
      expect.objectContaining({ name: 'comment', required: false }),
    )
    expect(actions.filter((action) => action.placements.includes('pull-request.primary'))).toEqual([])
    expect(actions.filter((action) => action.placements.includes('pull-request.secondary')).map((action) => action.id)).toEqual([
      'github.approve-auto-merge-pr',
    ])
    expect(actions.find((action) => action.id === 'github.approve-auto-merge-pr')?.placements).not.toContain('pull-request.review')
    expect(actions.find((action) => action.id === 'github.request-pr-changes')?.conditions).toContainEqual(
      expect.objectContaining({
        field: 'authored_by_me',
        value: false,
        disabledReason: 'You cannot request changes on your own pull request',
      }),
    )
  })

  it('revalidates the current head and identity before approving with auto-merge', async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view')
        return JSON.stringify({
          state: 'OPEN',
          isDraft: false,
          headRefOid: 'abc1234',
          author: { login: 'contributor' },
        })
      if (args[0] === 'api' && args[1] === 'user') return JSON.stringify({ login: 'reviewer' })
      return ''
    })
    const extension = createExtension({ run, host: host() as never })
    const action = (await registeredActions(extension)).get('github.approve-auto-merge')!

    await expect(
      action.execute(
        {
          repository: 'acme/widget',
          pull_number: 42,
          head_sha: 'abc1234',
        },
        { moduleId: 'github' },
      ),
    ).resolves.toMatchObject({ approved: true, auto_merge: true })
    expect(run).toHaveBeenCalledWith('gh', ['pr', 'review', '42', '--repo', 'acme/widget', '--approve'])
    expect(run).toHaveBeenCalledWith('gh', ['pr', 'merge', '42', '--repo', 'acme/widget', '--auto', '--squash'])
  })

  it('does not post a review when the pull request changed', async () => {
    const run = vi.fn(async () =>
      JSON.stringify({
        state: 'OPEN',
        isDraft: false,
        headRefOid: 'new-head',
        author: { login: 'contributor' },
      }),
    )
    const action = (await registeredActions(createExtension({ run, host: host() as never }))).get('github.approve')!

    await expect(
      action.execute(
        {
          repository: 'acme/widget',
          pull_number: 42,
          head_sha: 'old-head',
        },
        { moduleId: 'github' },
      ),
    ).rejects.toThrow('pull request changed')
    expect(run).not.toHaveBeenCalledWith('gh', expect.arrayContaining(['--approve']))
  })

  it('revalidates failing checks before approving', async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return JSON.stringify({
          state: 'OPEN',
          isDraft: false,
          headRefOid: 'abc1234',
          author: { login: 'contributor' },
          statusCheckRollup: [{ conclusion: 'FAILURE', state: 'COMPLETED' }],
        })
      }
      if (args[0] === 'api' && args[1] === 'user') return JSON.stringify({ login: 'reviewer' })
      return ''
    })
    const action = (await registeredActions(createExtension({ run, host: host() as never }))).get('github.approve')!

    await expect(
      action.execute(
        {
          repository: 'acme/widget',
          pull_number: 42,
          head_sha: 'abc1234',
        },
        { moduleId: 'github' },
      ),
    ).rejects.toThrow('Resolve failing GitHub Actions before approval')
    expect(run).not.toHaveBeenCalledWith('gh', expect.arrayContaining(['--approve']))
  })

  it('revalidates request-changes eligibility before posting the review', async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return JSON.stringify({
          state: 'OPEN',
          isDraft: false,
          headRefOid: 'abc1234',
          author: { login: 'reviewer' },
        })
      }
      if (args[0] === 'api' && args[1] === 'user') return JSON.stringify({ login: 'reviewer' })
      return ''
    })
    const action = (await registeredActions(createExtension({ run, host: host() as never }))).get('github.request-changes')!

    await expect(
      action.execute(
        {
          repository: 'acme/widget',
          pull_number: 42,
          head_sha: 'abc1234',
          comment: 'Please add a regression test',
        },
        { moduleId: 'github' },
      ),
    ).rejects.toThrow('You cannot request changes on your own pull request')
    expect(run).not.toHaveBeenCalledWith('gh', expect.arrayContaining(['--request-changes']))
  })

  it('does not request changes while the pull request is still a draft', async () => {
    const run = vi.fn(async () =>
      JSON.stringify({
        state: 'OPEN',
        isDraft: true,
        headRefOid: 'abc1234',
        author: { login: 'contributor' },
      }),
    )
    const action = (await registeredActions(createExtension({ run, host: host() as never }))).get('github.request-changes')!

    await expect(
      action.execute(
        {
          repository: 'acme/widget',
          pull_number: 42,
          head_sha: 'abc1234',
          comment: 'Please add a regression test',
        },
        { moduleId: 'github' },
      ),
    ).rejects.toThrow('Wait until the pull request is ready for review')
    expect(run).not.toHaveBeenCalledWith('gh', expect.arrayContaining(['--request-changes']))
  })
})

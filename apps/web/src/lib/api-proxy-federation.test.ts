import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@vertexade/platform-server/outbound-policy', () => ({
  OutboundRequestPolicy: class {
    fetch = (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args)
    dispose = async () => undefined
  },
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

function readModel(id: number, name: string) {
  return {
    instanceId: `${name}-instance`,
    version: id,
    updates: {
      repositories: {
        version: id,
        mode: 'replace',
        entries: [
          {
            key: String(id),
            value: { id, full_name: `${name}/api`, local_path: `/repos/${name}`, synced_at: null },
            sourceUpdatedAt: null,
            position: 0,
          },
        ],
      },
      dashboardMeta: {
        version: id,
        mode: 'replace',
        entries: [
          {
            key: 'current',
            value: { presets: [], highlights: [], service_colors: [], pr_tasks: [], cleanup_worktrees: [], modules: [] },
            sourceUpdatedAt: null,
            position: 0,
          },
        ],
      },
    },
  }
}

describe('multi-backend API proxy', () => {
  it('rejects oversized JSON requests before proxying them to a backend', async () => {
    vi.stubEnv('VERTEXADE_API_URL', 'http://local.internal')
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/settings/linked-servers') return Response.json({ servers: [] })
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')

    const response = await proxyApiRequest({
      request: new Request('http://frontend.internal/api/settings/example', {
        method: 'POST',
        headers: { 'content-length': '100001', 'content-type': 'application/json' },
        body: '{}',
      }),
    })

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Request body is too large' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('drops an oversized remote read model without buffering its body', async () => {
    vi.stubEnv(
      'VERTEXADE_API_URLS',
      JSON.stringify([
        { id: 'local', label: 'Local', url: 'http://local.internal' },
        { id: 'team', label: 'Team', url: 'http://team.internal' },
      ]),
    )
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/settings/linked-servers') return Response.json({ servers: [] })
      if (url.pathname === '/api/read-model' && url.host === 'local.internal') return Response.json(readModel(1, 'local'))
      if (url.pathname === '/api/read-model') {
        return new Response('{}', {
          headers: { 'content-length': String(32 * 1024 * 1024 + 1), 'content-type': 'application/json' },
        })
      }
      return Response.json({ error: 'Unexpected test request' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')

    const response = await proxyApiRequest({ request: new Request('http://frontend.internal/api/read-model?since=0') })
    const payload = await response.json()

    expect(payload.updates.repositories.entries).toHaveLength(1)
    expect(payload.updates.dashboardMeta.entries[0].value.backends).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'team', connected: false, error: 'Response body is too large' })]),
    )
  })

  it('does not forward primary-server credentials to another backend', async () => {
    vi.stubEnv(
      'VERTEXADE_API_URLS',
      JSON.stringify([
        { id: 'local', label: 'Local', url: 'http://local.internal' },
        { id: 'team', label: 'Team', url: 'http://team.internal' },
      ]),
    )
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/settings/linked-servers') return Response.json({ servers: [] })
      if (url.pathname === '/api/read-model') {
        return Response.json(url.host === 'local.internal' ? readModel(1, 'local') : readModel(2, 'team'))
      }
      return Response.json({ error: 'Unexpected test request' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')

    await proxyApiRequest({
      request: new Request('http://frontend.internal/api/read-model?since=0', {
        headers: {
          authorization: 'Bearer primary-secret',
          cookie: 'primary-session=secret',
          'proxy-authorization': 'Basic c2VjcmV0',
        },
      }),
    })

    const requestHeaders = (host: string) => {
      const call = fetch.mock.calls.find(
        ([input]) => new URL(String(input)).host === host && new URL(String(input)).pathname === '/api/read-model',
      )
      if (!call) throw new Error(`Missing read-model request for ${host}`)
      return new Headers(call[1]?.headers)
    }
    expect(requestHeaders('local.internal').get('authorization')).toBe('Bearer primary-secret')
    expect(requestHeaders('local.internal').get('cookie')).toBe('primary-session=secret')
    expect(requestHeaders('team.internal').has('authorization')).toBe(false)
    expect(requestHeaders('team.internal').has('cookie')).toBe(false)
    expect(requestHeaders('team.internal').has('proxy-authorization')).toBe(false)
  })

  it('discovers backend-managed linked servers without frontend URL configuration', async () => {
    vi.stubEnv('VERTEXADE_API_URL', 'http://local.internal')
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.host === 'local.internal' && url.pathname === '/api/settings/linked-servers') {
        return Response.json({ servers: [{ id: 'team', label: 'Team', url: 'http://team.internal', namespace: 1, enabled: true }] })
      }
      if (url.pathname === '/api/read-model') {
        return Response.json(url.host === 'local.internal' ? readModel(1, 'local') : readModel(2, 'team'))
      }
      return Response.json({ error: 'Unexpected test request' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')

    const response = await proxyApiRequest({ request: new Request('http://frontend.internal/api/read-model?since=0') })
    const payload = await response.json()
    expect(payload.updates.repositories.entries).toMatchObject([
      { key: 'server-1:1', value: { backend_name: 'local.internal' } },
      { key: 'team:2', value: { backend_name: 'Team' } },
    ])
  })

  it('merges server read models and routes a namespaced entity back to its source', async () => {
    vi.stubEnv(
      'VERTEXADE_API_URLS',
      JSON.stringify([
        { id: 'local', label: 'Local', url: 'http://local.internal' },
        { id: 'team', label: 'Team', url: 'http://team.internal' },
      ]),
    )
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/read-model') {
        return Response.json(url.host === 'local.internal' ? readModel(1, 'local') : readModel(7, 'team'))
      }
      if (url.host === 'team.internal' && url.pathname === '/api/agent-threads/7/log') {
        return Response.json({ id: 7, repo_id: 7, status: 'completed', kind: 'task', thread_id: 'thread-team', agent_id: 'codex' })
      }
      if (url.host === 'team.internal' && url.pathname === '/api/extensions/container-preview/agent-threads/7') {
        return Response.json({ status: 'running' })
      }
      if (url.host === 'team.internal' && url.pathname === '/api/pulls/7/17/impact-analysis') {
        return Response.json({ id: 4, subject: { repositoryId: 7, pullRequestNumber: 17 }, freshness: 'current' })
      }
      if (url.host === 'team.internal' && url.pathname === '/api/pulls/7/17/validation-runs') {
        return Response.json({ runs: [{ id: 9, repositoryId: 7 }], errors: [] })
      }
      if (url.host === 'team.internal' && url.pathname === '/api/repositories/7/validation-runs/9/log') {
        return Response.json({ output: 'remote evidence' })
      }
      if (url.host === 'team.internal' && url.pathname === '/api/repositories/7/validation-runs/9/repair-loop') {
        return Response.json({
          id: 2,
          rootRunId: 9,
          currentRunId: 11,
          currentJobId: 14,
          state: 'active',
          maxAttempts: 3,
          attemptCount: 1,
        })
      }
      if (url.host === 'team.internal' && url.pathname === '/api/pulls/7/17/evidence') {
        return Response.json({ id: 10, repositoryId: 7, readiness: 'ready' })
      }
      if (url.host === 'team.internal' && url.pathname === '/api/migration-campaigns/12/control') {
        return Response.json({
          id: 12,
          federationGroupId: 'group-remote',
          recipe: {
            id: 3,
            key: 'node-types',
            version: 1,
            configuration: { kind: 'dependency_upgrade', packageName: '@types/node', targetVersion: '^24.0.0', sections: [] },
          },
          targets: [{ id: 4, campaignId: 12, repositoryId: 7 }],
        })
      }
      if (url.host === 'team.internal' && url.pathname === '/api/migration-campaigns') {
        return Response.json({
          id: 13,
          federationGroupId: 'group-created',
          recipe: { id: 3, key: 'node-types', version: 1, configuration: { kind: 'dependency_upgrade' } },
          targets: [],
        })
      }
      return Response.json({ error: 'Unexpected test request' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)
    const { proxyApiRequest } = await import('./api-proxy')

    const response = await proxyApiRequest({ request: new Request('http://frontend.internal/api/read-model?since=0') })
    const payload = await response.json()
    expect(payload.updates.repositories.entries).toMatchObject([
      { key: 'local:1', value: { id: 1, backend_id: 'local', backend_name: 'Local' } },
      { key: 'team:7', value: { id: 1_000_000_007, backend_id: 'team', backend_name: 'Team' } },
    ])
    expect(payload.updates.dashboardMeta.entries[0].value.backends).toMatchObject([
      { id: 'local', connected: true },
      { id: 'team', connected: true },
    ])

    const jobResponse = await proxyApiRequest({
      request: new Request('http://frontend.internal/api/agent-threads/1000000007/log', {
        headers: { 'x-vertexade-backend': 'local' },
      }),
    })
    expect(await jobResponse.json()).toMatchObject({
      id: 1_000_000_007,
      repo_id: 1_000_000_007,
      backend_id: 'team',
    })
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('http://team.internal/api/agent-threads/7/log'),
      expect.objectContaining({ method: 'GET' }),
    )

    const previewResponse = await proxyApiRequest({
      request: new Request('http://frontend.internal/api/extensions/container-preview/agent-threads/1000000007', {
        headers: { 'x-vertexade-backend': 'local' },
      }),
    })
    expect(await previewResponse.json()).toEqual({ status: 'running' })
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('http://team.internal/api/extensions/container-preview/agent-threads/7'),
      expect.objectContaining({ method: 'GET' }),
    )

    const impactResponse = await proxyApiRequest({
      request: new Request('http://frontend.internal/api/pulls/1000000007/17/impact-analysis', {
        method: 'POST',
        headers: { 'x-vertexade-backend': 'local' },
      }),
    })
    expect(await impactResponse.json()).toMatchObject({
      id: 1_000_000_004,
      subject: { repositoryId: 1_000_000_007 },
      freshness: 'current',
    })
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('http://team.internal/api/pulls/7/17/impact-analysis'),
      expect.objectContaining({ method: 'POST' }),
    )

    const validationResponse = await proxyApiRequest({
      request: new Request('http://frontend.internal/api/pulls/1000000007/17/validation-runs', {
        method: 'POST',
        headers: { 'x-vertexade-backend': 'local' },
      }),
    })
    expect(await validationResponse.json()).toMatchObject({ runs: [{ id: 1_000_000_009, repositoryId: 1_000_000_007 }] })
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('http://team.internal/api/pulls/7/17/validation-runs'),
      expect.objectContaining({ method: 'POST' }),
    )

    const logResponse = await proxyApiRequest({
      request: new Request('http://frontend.internal/api/repositories/1000000007/validation-runs/1000000009/log', {
        headers: { 'x-vertexade-backend': 'local' },
      }),
    })
    expect(await logResponse.json()).toEqual({ output: 'remote evidence' })
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('http://team.internal/api/repositories/7/validation-runs/9/log'),
      expect.objectContaining({ method: 'GET' }),
    )

    const loopResponse = await proxyApiRequest({
      request: new Request('http://frontend.internal/api/repositories/1000000007/validation-runs/1000000009/repair-loop', {
        method: 'POST',
        headers: { 'x-vertexade-backend': 'local' },
      }),
    })
    expect(await loopResponse.json()).toMatchObject({
      rootRunId: 1_000_000_009,
      currentRunId: 1_000_000_011,
      currentJobId: 1_000_000_014,
    })
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('http://team.internal/api/repositories/7/validation-runs/9/repair-loop'),
      expect.objectContaining({ method: 'POST' }),
    )

    const evidenceResponse = await proxyApiRequest({
      request: new Request('http://frontend.internal/api/pulls/1000000007/17/evidence', {
        method: 'POST',
        headers: { 'x-vertexade-backend': 'local' },
      }),
    })
    expect(await evidenceResponse.json()).toMatchObject({ id: 1_000_000_010, repositoryId: 1_000_000_007, readiness: 'ready' })
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('http://team.internal/api/pulls/7/17/evidence'),
      expect.objectContaining({ method: 'POST' }),
    )

    const campaignResponse = await proxyApiRequest({
      request: new Request('http://frontend.internal/api/migration-campaigns/1000000012/control', {
        method: 'POST',
        headers: { 'x-vertexade-backend': 'local', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'retry', targetId: 1_000_000_004 }),
      }),
    })
    expect(await campaignResponse.json()).toMatchObject({
      id: 1_000_000_012,
      backend_id: 'team',
      recipe: { id: 1_000_000_003 },
      targets: [{ id: 1_000_000_004, campaignId: 1_000_000_012, repositoryId: 1_000_000_007 }],
    })
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('http://team.internal/api/migration-campaigns/12/control'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'retry', targetId: 4 }) }),
    )

    const createCampaignResponse = await proxyApiRequest({
      request: new Request('http://frontend.internal/api/backends/team/migration-campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ federationGroupId: 'group-created', recipeId: 1_000_000_003, repositoryIds: [1_000_000_007] }),
      }),
    })
    expect(await createCampaignResponse.json()).toMatchObject({ id: 1_000_000_013, backend_id: 'team' })
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('http://team.internal/api/migration-campaigns'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ federationGroupId: 'group-created', recipeId: 3, repositoryIds: [7] }),
      }),
    )
  })
})

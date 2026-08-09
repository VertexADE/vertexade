import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@vertexade/platform-server/outbound-policy', () => ({
  OutboundRequestPolicy: class {
    fetch = (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args)
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
      request: new Request('http://frontend.internal/api/agent-threads/1000000007/log'),
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
  })
})

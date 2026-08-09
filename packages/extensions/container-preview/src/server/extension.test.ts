import { describe, expect, it, vi } from 'vite-plus/test'
import type { ExtensionHostServices, ExtensionRoute } from '@vertexade/platform-contracts'
import { createExtension } from './extension.ts'

function fixture() {
  const routes: ExtensionRoute[] = []
  const previews = {
    settings: vi.fn(() => ({ domain: 'previews.example.test', gatewayPort: 4180 })),
    updateSettings: vi.fn(async (input) => input),
    get: vi.fn(async (jobId) => ({ jobId, status: 'idle' })),
    start: vi.fn(async (jobId) => ({ jobId, status: 'starting' })),
    restart: vi.fn(async (jobId) => ({ jobId, status: 'starting' })),
    stop: vi.fn(async (jobId) => ({ jobId, status: 'stopping' })),
    logs: vi.fn(async (jobId) => ({ jobId, services: [] })),
  }
  const host = { workspacePreviews: previews } as unknown as ExtensionHostServices
  const extension = createExtension({ host })
  void extension.register?.({
    routes: { register: (route: ExtensionRoute) => routes.push(route) },
  } as never)
  return { extension, previews, routes }
}

describe('container preview extension', () => {
  it('owns the optional preview route surface', () => {
    const { extension, routes } = fixture()
    expect(extension.manifest.id).toBe('container-preview')
    expect(routes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /settings',
      'POST /settings',
      'GET /agent-threads/:threadId',
      'POST /agent-threads/:threadId/start',
      'POST /agent-threads/:threadId/restart',
      'POST /agent-threads/:threadId/stop',
      'GET /agent-threads/:threadId/logs',
    ])
  })

  it('delegates preview operations through the generic host service', async () => {
    const { previews, routes } = fixture()
    const start = routes.find(({ path }) => path.endsWith('/start'))!
    const response = await start.handler(new Request('http://local'), {
      moduleId: 'container-preview',
      params: { threadId: '42' },
      signal: AbortSignal.timeout(1_000),
    })
    expect(response.status).toBe(202)
    expect(previews.start).toHaveBeenCalledWith(42)
  })
})

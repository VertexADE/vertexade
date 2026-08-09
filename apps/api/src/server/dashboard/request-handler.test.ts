import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, expect, it, vi } from 'vite-plus/test'
import { DashboardCorsPolicy } from './cors-policy.ts'
import { createDashboardRequestHandler } from './request-handler.ts'

function createHandler() {
  const calls = vi.fn()
  const handler = createDashboardRequestHandler({
    agents: {
      require: () => ({ id: 'codex', parseLaunchOptions: () => ({}) }),
    } as any,
    agentProvider: 'codex',
    launchContext: new AsyncLocalStorage(),
    events: {
      stream: () => new Response('events', { headers: { 'content-type': 'text/event-stream' } }),
    } as any,
    subagentDispatch: async (request) => {
      calls(new URL(request.url).pathname)
      return new URL(request.url).pathname === '/api/subagent' ? Response.json({ route: 'subagent' }) : null
    },
    coreRouters: [
      {
        dispatch: async (request) => {
          const path = new URL(request.url).pathname
          if (path === '/api/core') return Response.json({ route: 'core' })
          if (path === '/api/core-error') throw new Error('route failed')
          return null
        },
      },
    ],
    extensionDispatch: async () => Response.json({ route: 'extension' }),
    api: async () => Response.json({ route: 'legacy' }),
    cors: new DashboardCorsPolicy(['https://dashboard.example']),
  })
  return { calls, handler }
}

describe('dashboard request handler CORS boundary', () => {
  it.each(['/api/subagent', '/api/core', '/api/extensions/example/action', '/api/legacy', '/api/events', '/api/core-error'])(
    'decorates %s after routing',
    async (path) => {
      const { handler } = createHandler()
      const response = await handler(new Request(`http://api.example${path}`, { headers: { origin: 'https://dashboard.example' } }))
      expect(response.headers.get('access-control-allow-origin')).toBe('https://dashboard.example')
      expect(response.headers.get('vary')).toContain('Origin')
      expect(response.headers.get('access-control-allow-origin')).not.toBe('*')
    },
  )

  it('rejects denied origins and preflights before any route runs', async () => {
    const { calls, handler } = createHandler()
    const denied = await handler(new Request('http://api.example/api/legacy', { headers: { origin: 'https://attacker.example' } }))
    const preflight = await handler(
      new Request('http://api.example/api/legacy', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://dashboard.example',
          'access-control-request-method': 'PATCH',
          'access-control-request-headers': 'content-type',
        },
      }),
    )
    expect(denied.status).toBe(403)
    expect(preflight.status).toBe(204)
    expect(calls).not.toHaveBeenCalled()
  })
})

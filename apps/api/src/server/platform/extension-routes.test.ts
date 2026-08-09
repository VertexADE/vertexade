import { describe, expect, it } from 'vite-plus/test'
import { ExtensionRouteRegistry } from './extension-routes.ts'
import { HttpError } from '@vertexade/platform-server/http'

describe('extension route registry', () => {
  it('scopes routes to their owning module and parses parameters', async () => {
    const routes = new ExtensionRouteRegistry()
    routes.register('sentry', {
      method: 'GET',
      path: '/findings/:findingId',
      handler: (_request, context) => Response.json(context),
    })

    const response = await routes.dispatch(new Request('http://localhost/api/extensions/sentry/findings/ISSUE-42'))
    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toMatchObject({
      moduleId: 'sentry',
      params: { findingId: 'ISSUE-42' },
    })
  })

  it('does not dispatch routes belonging to disabled modules', async () => {
    const routes = new ExtensionRouteRegistry(() => false)
    routes.register('sentry', { method: 'GET', path: '/', handler: () => new Response('secret') })

    const response = await routes.dispatch(new Request('http://localhost/api/extensions/sentry'))
    expect(response?.status).toBe(404)
  })

  it('allows installed-only settings routes while a module is disabled', async () => {
    const routes = new ExtensionRouteRegistry(() => false)
    routes.register('sentry', {
      method: 'GET',
      path: '/settings',
      availability: 'installed',
      handler: () => Response.json({ configured: false }),
    })
    const response = await routes.dispatch(new Request('http://localhost/api/extensions/sentry/settings'))
    expect(response?.status).toBe(200)
  })

  it('turns typed HTTP boundary failures into client responses', async () => {
    const routes = new ExtensionRouteRegistry()
    routes.register('sentry', {
      method: 'POST',
      path: '/settings',
      handler: () => {
        throw new HttpError('Request body must be a JSON object', 400)
      },
    })

    const response = await routes.dispatch(new Request('http://localhost/api/extensions/sentry/settings', { method: 'POST' }))
    expect(response?.status).toBe(400)
    await expect(response?.json()).resolves.toEqual({ error: 'Request body must be a JSON object' })
  })

  it('rejects route traversal and duplicate registrations', () => {
    const routes = new ExtensionRouteRegistry()
    expect(() =>
      routes.register('sentry', {
        method: 'GET',
        path: '/../settings',
        handler: () => new Response(),
      }),
    ).toThrow('cannot traverse directories')
    routes.register('sentry', { method: 'GET', path: '/findings', handler: () => new Response() })
    expect(() =>
      routes.register('sentry', {
        method: 'get',
        path: '/findings',
        handler: () => new Response(),
      }),
    ).toThrow('Extension route already registered')
  })

  it('rejects ambiguous route parameters', () => {
    const routes = new ExtensionRouteRegistry()
    expect(() =>
      routes.register('sentry', {
        method: 'GET',
        path: '/:id/findings/:id',
        handler: () => new Response(),
      }),
    ).toThrow('invalid or duplicate parameters')
  })

  it('times out slow extension handlers even when they ignore cancellation', async () => {
    const routes = new ExtensionRouteRegistry()
    routes.register('slow', {
      method: 'GET',
      path: '/',
      timeoutMs: 100,
      handler: () => new Promise(() => {}),
    })

    const response = await routes.dispatch(new Request('http://localhost/api/extensions/slow'))

    expect(response?.status).toBe(504)
  })
})

import { describe, expect, it } from 'vite-plus/test'
import { HttpError } from './http.ts'
import { HttpRouter } from './router.ts'

describe('HTTP router', () => {
  it('dispatches typed routes and decoded parameters', async () => {
    const router = new HttpRouter<{ prefix: string }>().get('/api/items/:itemId', (_request, { params, prefix }) =>
      Response.json({ id: params.itemId, prefix }),
    )
    const response = await router.dispatch(new Request('http://localhost/api/items/A%2042'), {
      prefix: 'item',
    })

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual({ id: 'A 42', prefix: 'item' })
  })

  it('returns null for unmatched routes and translates expected HTTP failures', async () => {
    const router = new HttpRouter().post('/api/items', () => {
      throw new HttpError('Already exists', 409)
    })

    expect(await router.dispatch(new Request('http://localhost/api/other'), {})).toBeNull()
    const response = await router.dispatch(new Request('http://localhost/api/items', { method: 'POST' }), {})
    expect(response?.status).toBe(409)
    await expect(response?.json()).resolves.toEqual({ error: 'Already exists' })
  })

  it('rejects duplicate and invalid route definitions', () => {
    const router = new HttpRouter().get('/api/items/:id', () => new Response())
    expect(() => router.get('/api/items/:id', () => new Response())).toThrow('already registered')
    expect(() => router.get('/api/items/:id/:id', () => new Response())).toThrow('duplicate parameters')
    expect(() => router.get('../items', () => new Response())).toThrow('must be absolute')
  })
})

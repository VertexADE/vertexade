import { Effect } from 'effect'
import { apiRequestEffect, runApiEffectResponse } from './effect/index.ts'
import { assertRoutePath, matchRouteSegments, routeSegments } from './route-pattern.ts'

export type HttpRouteContext<TContext> = TContext & { params: Record<string, string> }
export type HttpRouteHandler<TContext> = (request: Request, context: HttpRouteContext<TContext>) => Response | Promise<Response>

type RegisteredRoute<TContext> = {
  method: string
  path: string
  segments: string[]
  handler: HttpRouteHandler<TContext>
}

export class HttpRouter<TContext extends object = Record<never, never>> {
  readonly #routes: RegisteredRoute<TContext>[] = []

  register(method: string, path: string, handler: HttpRouteHandler<TContext>) {
    const normalizedMethod = method.trim().toUpperCase()
    if (!normalizedMethod) throw new Error('HTTP routes require a method')
    assertRoutePath(path, 'HTTP route')
    if (typeof handler !== 'function') throw new Error('HTTP routes require a handler')
    const pathSegments = routeSegments(path)
    if (this.#routes.some((route) => route.method === normalizedMethod && route.path === path))
      throw new Error(`HTTP route already registered: ${normalizedMethod} ${path}`)
    this.#routes.push({ method: normalizedMethod, path, segments: pathSegments, handler })
    return this
  }

  get(path: string, handler: HttpRouteHandler<TContext>) {
    return this.register('GET', path, handler)
  }
  post(path: string, handler: HttpRouteHandler<TContext>) {
    return this.register('POST', path, handler)
  }
  patch(path: string, handler: HttpRouteHandler<TContext>) {
    return this.register('PATCH', path, handler)
  }
  delete(path: string, handler: HttpRouteHandler<TContext>) {
    return this.register('DELETE', path, handler)
  }

  async dispatch(request: Request, context: TContext) {
    const actual = routeSegments(new URL(request.url).pathname)
    for (const route of this.#routes) {
      if (route.method !== request.method.toUpperCase()) continue
      const params = matchRouteSegments(route.segments, actual)
      if (!params) continue
      const program = apiRequestEffect(request, (scopedRequest) => Promise.resolve(route.handler(scopedRequest, { ...context, params })), {
        kind: 'unexpected',
        message: 'Request failed',
        status: 500,
        code: 'ROUTE_HANDLER_FAILED',
        causeMessage: 'ignore',
      }).pipe(Effect.withSpan(`http.route ${route.method} ${route.path}`))

      return runApiEffectResponse(program, (response) => response, undefined, {
        signal: request.signal,
      })
    }
    return null
  }
}

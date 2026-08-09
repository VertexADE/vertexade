import type { ExtensionRoute } from '@vertexade/platform-contracts'
import { apiFailure, apiRequestEffect, runApiEffectResponse } from '@vertexade/platform-server/effect'
import { assertRoutePath, matchRouteSegments, routeSegments } from '@vertexade/platform-server/route-pattern'
import { Duration, Effect } from 'effect'

type RegisteredRoute = ExtensionRoute & {
  moduleId: string
  fullPath: string
  segments: string[]
}

export class ExtensionRouteRegistry {
  readonly #isModuleEnabled: (moduleId: string) => boolean
  readonly #routes: RegisteredRoute[] = []

  constructor(isModuleEnabled: (moduleId: string) => boolean = () => true) {
    this.#isModuleEnabled = isModuleEnabled
  }

  register(moduleId: string, route: ExtensionRoute) {
    const method = route.method.trim().toUpperCase()
    if (!method) throw new Error('Extension routes require an HTTP method')
    assertRoutePath(route.path, 'Extension route')
    if (typeof route.handler !== 'function') throw new Error('Extension routes require a handler')
    if (route.timeoutMs !== undefined && (!Number.isInteger(route.timeoutMs) || route.timeoutMs < 100 || route.timeoutMs > 300_000))
      throw new Error('Extension route timeout must be between 100ms and 300000ms')
    const fullPath = `/api/extensions/${moduleId}${route.path === '/' ? '' : route.path}`
    const duplicate = this.#routes.some((entry) => entry.method === method && entry.fullPath === fullPath)
    if (duplicate) throw new Error(`Extension route already registered: ${method} ${fullPath}`)
    this.#routes.push({ ...route, method, moduleId, fullPath, segments: routeSegments(fullPath) })
  }

  async dispatch(request: Request) {
    const url = new URL(request.url)
    const actual = routeSegments(url.pathname)
    for (const route of this.#routes) {
      if (route.method !== request.method.toUpperCase()) continue
      const params = matchRouteSegments(route.segments, actual)
      if (!params) continue
      if (route.availability !== 'installed' && !this.#isModuleEnabled(route.moduleId))
        return Response.json({ error: `${route.moduleId} extension is disabled` }, { status: 404 })
      const program = apiRequestEffect(
        request,
        (scopedRequest, signal) =>
          Promise.resolve(
            route.handler(scopedRequest, {
              moduleId: route.moduleId,
              params,
              signal,
            }),
          ),
        {
          kind: 'unexpected',
          message: `${route.moduleId} extension request failed`,
          status: 500,
          code: 'EXTENSION_ROUTE_FAILED',
          causeMessage: 'ignore',
        },
      ).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(route.timeoutMs || 30_000),
          onTimeout: () =>
            apiFailure({
              kind: 'upstream',
              message: `${route.moduleId} extension request timed out`,
              status: 504,
              code: 'EXTENSION_ROUTE_TIMEOUT',
            }),
        }),
        Effect.withSpan(`extension.route ${route.moduleId} ${route.method} ${route.path}`),
      )

      return runApiEffectResponse(program, (response) => response, undefined, {
        signal: request.signal,
      })
    }
    return null
  }

  removeModule(moduleId: string) {
    for (let index = this.#routes.length - 1; index >= 0; index -= 1) {
      const route = this.#routes[index]
      if (route?.moduleId === moduleId) this.#routes.splice(index, 1)
    }
  }
}

import type { AsyncLocalStorage } from 'node:async_hooks'
import { Effect } from 'effect'
import { apiRequestEffect, runApiEffectResponse } from '@vertexade/platform-server/effect'
import { HttpError } from '@vertexade/platform-server/http'
import type { AgentRegistry } from '../agents/registry.ts'
import { resolveSubagentLaunch } from '../agents/subagents.ts'
import type { DashboardEvents } from '../events/dashboard-events.ts'
import { configuredDashboardCorsPolicy, type DashboardCorsPolicy } from './cors-policy.ts'
import { secureDashboardResponse } from './response-security.ts'
import { transportClientIdentity } from '../transport-context.ts'

type Router = { dispatch(request: Request, context?: Record<string, unknown>): Promise<Response | null> }
type ApiHandler = (request: Request, url: URL) => Promise<Response | null>
type LaunchContext = {
  agentId?: string
  model?: string
  reasoningEffort?: string
  serviceTier?: string
  ephemeral?: boolean
  allowSubagents?: boolean
}

export function createDashboardApiDispatcher(handlers: ApiHandler[], notFound: () => Response) {
  return async (request: Request, url: URL) => {
    for (const handler of handlers) {
      const response = await handler(request, url)
      if (response) return response
    }
    return notFound()
  }
}

export function createDashboardRequestHandler({
  agents,
  agentProvider,
  launchContext,
  events,
  subagentDispatch,
  coreRouters,
  extensionDispatch,
  api,
  cors = configuredDashboardCorsPolicy(),
}: {
  agents: AgentRegistry
  agentProvider: string
  launchContext: AsyncLocalStorage<LaunchContext>
  events: DashboardEvents
  subagentDispatch(request: Request): Promise<Response | null>
  coreRouters: Router[]
  extensionDispatch(request: Request): Promise<Response | null>
  api(request: Request, url: URL): Promise<Response>
  cors?: DashboardCorsPolicy
}) {
  async function registeredRoute(request: Request, url: URL) {
    const subagentResponse = await subagentDispatch(request)
    if (subagentResponse) return subagentResponse
    for (const router of coreRouters) {
      const response = await router.dispatch(request, {})
      if (response) return response
    }
    if (!url.pathname.startsWith('/api/extensions/')) return null
    try {
      return await extensionDispatch(request)
    } catch (error) {
      console.error(`Extension API request failed for ${url.pathname}:`, error)
      return error instanceof HttpError
        ? Response.json({ error: error.message }, { status: error.status })
        : Response.json({ error: 'Extension request failed' }, { status: 500 })
    }
  }

  function immediateResponse(request: Request, url: URL) {
    if (request.method === 'GET' && url.pathname === '/api/events')
      return events.stream({ signal: request.signal, identity: transportClientIdentity(request) })
    return null
  }

  function apiResponse(request: Request, url: URL) {
    const program = apiRequestEffect(
      request,
      (scopedRequest) => {
        const headers = Object.fromEntries(scopedRequest.headers.entries())
        const selectedAgent = agents.require(headers['x-agent-provider'] || agentProvider)
        const ephemeral = headers['x-agent-ephemeral']
        if (ephemeral && !['true', 'false'].includes(ephemeral)) throw new HttpError('x-agent-ephemeral must be true or false', 400)
        const subagents = headers['x-agent-subagents']
        if (subagents && !['true', 'false'].includes(subagents)) throw new HttpError('x-agent-subagents must be true or false', 400)
        return launchContext.run(
          {
            agentId: selectedAgent.id,
            ...(selectedAgent.parseLaunchOptions?.(headers) || {}),
            ...(ephemeral ? { ephemeral: ephemeral === 'true' } : {}),
            allowSubagents: resolveSubagentLaunch(selectedAgent, subagents === 'true'),
          },
          () => api(scopedRequest, new URL(scopedRequest.url)),
        )
      },
      {
        kind: 'unexpected',
        message: 'Unexpected API error',
        status: 500,
        code: 'API_REQUEST_FAILED',
        causeMessage: 'replace',
      },
    ).pipe(Effect.withSpan(`api.request ${request.method} ${url.pathname}`))

    return runApiEffectResponse(
      program,
      (response) => response,
      (failure) => {
        if (failure.kind === 'unexpected') console.error(failure.cause)
        return Response.json({ error: failure.message }, { status: failure.status })
      },
      { signal: request.signal },
    )
  }

  return async function handleDashboardRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const corsResponse = cors.before(request)
    if (corsResponse) return secureDashboardResponse(corsResponse)
    let response: Response
    try {
      const immediate = immediateResponse(request, url)
      if (immediate) response = immediate
      else response = (await registeredRoute(request, url)) || (await apiResponse(request, url))
    } catch (error) {
      console.error(`Dashboard request failed for ${url.pathname}:`, error)
      response = Response.json({ error: 'Unexpected API error' }, { status: 500 })
    }
    return secureDashboardResponse(cors.after(request, response))
  }
}

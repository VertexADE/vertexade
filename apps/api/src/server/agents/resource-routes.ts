import type { AgentResourceService } from './resources.ts'
import { HttpError, readJsonObject } from '@vertexade/platform-server/http'
import { searchMcpRegistry } from './mcp-registry.ts'

function response(status: number, value: unknown) {
  return Response.json(value, { status })
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
function kind(value: string) {
  if (value !== 'skill' && value !== 'mcp') throw new Error('Agent resource kind must be skill or mcp')
  return value
}

export function createAgentResourceRoutes(service: AgentResourceService, profilesChanged: () => void = () => {}) {
  return async (request: Request) => {
    try {
      return await dispatch(request, service, profilesChanged)
    } catch (error) {
      return response(error instanceof HttpError ? error.status : 400, { error: message(error) })
    }
  }
}

async function dispatch(request: Request, service: AgentResourceService, profilesChanged: () => void) {
  const url = new URL(request.url)
  const routes = [
    () => exactRoute(request, url, service, profilesChanged),
    () => defaultRoute(request, url, service),
    () => removalRoute(request, url, service),
    () => profileRemovalRoute(request, url, service, profilesChanged),
    () => workSelectionRoute(request, url, service),
  ]
  for (const route of routes) {
    const result = await route()
    if (result) return result
  }
  return null
}

async function exactRoute(request: Request, url: URL, service: AgentResourceService, profilesChanged: () => void) {
  const routes: Record<string, () => unknown | Promise<unknown>> = {
    'GET /api/agent-resources': () => service.catalog(),
    'GET /api/agent-resources/selection': () => service.selection(Number(url.searchParams.get('work_item_id') || 0) || null),
    'GET /api/agent-resources/skills/search': async () => ({
      results: await service.searchSkills(url.searchParams.get('query')),
    }),
    'GET /api/agent-resources/mcp/search': async () => ({
      results: await searchMcpRegistry(url.searchParams.get('query') || ''),
    }),
    'POST /api/agent-resources/skills': async () => service.addSkill(await readJsonObject(request)),
    'POST /api/agent-resources/mcp': async () => service.upsertMcpServer(await readJsonObject(request)),
    'POST /api/agent-resources/profiles': async () => {
      const profile = service.upsertProfile(await readJsonObject(request))
      profilesChanged()
      return profile
    },
  }
  const handler = routes[`${request.method} ${url.pathname}`]
  return handler ? response(request.method === 'POST' ? 201 : 200, await handler()) : null
}

function profileRemovalRoute(request: Request, url: URL, service: AgentResourceService, profilesChanged: () => void) {
  const match = url.pathname.match(/^\/api\/agent-resources\/profiles\/([^/]+)$/)
  if (request.method !== 'DELETE' || !match) return null
  service.removeProfile(decodeURIComponent(match[1]!))
  profilesChanged()
  return response(200, { removed: true })
}

async function defaultRoute(request: Request, url: URL, service: AgentResourceService) {
  const defaultMatch = url.pathname.match(/^\/api\/agent-resources\/(skill|mcp)\/([^/]+)\/default$/)
  return request.method === 'POST' && defaultMatch ? updateDefault(request, defaultMatch, service) : null
}

function removalRoute(request: Request, url: URL, service: AgentResourceService) {
  const resourceMatch = url.pathname.match(/^\/api\/agent-resources\/(skill|mcp)\/([^/]+)$/)
  if (request.method !== 'DELETE' || !resourceMatch) return null
  service.remove(kind(resourceMatch[1]!), decodeURIComponent(resourceMatch[2]!))
  return response(200, { removed: true })
}

async function updateDefault(request: Request, match: RegExpMatchArray, service: AgentResourceService) {
  const input = await readJsonObject(request)
  return response(200, service.setDefault(kind(match[1]!), decodeURIComponent(match[2]!), input.enabled === true))
}

async function workSelectionRoute(request: Request, url: URL, service: AgentResourceService) {
  const match = url.pathname.match(/^\/api\/work-items\/(\d+)\/agent-resources$/)
  if (!match) return null
  if (request.method === 'GET') return response(200, service.selection(Number(match[1])))
  if (request.method === 'PUT') return response(200, service.setSelection(Number(match[1]), await readJsonObject(request)))
  return null
}

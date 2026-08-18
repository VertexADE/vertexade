import type { AgentResourceService } from './resources.ts'
import { HttpError, readJsonObject } from '@vertexade/platform-server/http'
import { searchMcpRegistry } from './mcp-registry.ts'
import { McpGatewayPool, toolAppResourceUri } from './mcp-gateway.ts'

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
  const gateways = new McpGatewayPool()
  return async (request: Request) => {
    try {
      return await dispatch(request, service, profilesChanged, gateways)
    } catch (error) {
      return response(error instanceof HttpError ? error.status : 400, { error: message(error) })
    }
  }
}

async function dispatch(request: Request, service: AgentResourceService, profilesChanged: () => void, gateways: McpGatewayPool) {
  const url = new URL(request.url)
  const routes = [
    () => exactRoute(request, url, service, profilesChanged, gateways),
    () => pluginRoute(request, url, service, gateways),
    () => defaultRoute(request, url, service),
    () => removalRoute(request, url, service, gateways),
    () => profileRemovalRoute(request, url, service, profilesChanged),
    () => workSelectionRoute(request, url, service),
    () => mcpGatewayRoute(request, url, service, gateways),
  ]
  for (const route of routes) {
    const result = await route()
    if (result) return result
  }
  return null
}

async function mcpGatewayRoute(request: Request, url: URL, service: AgentResourceService, gateways: McpGatewayPool) {
  const taskMatch = url.pathname.match(/^\/api\/agent-resources\/mcp\/([^/]+)\/tasks\/([^/]+)(?:\/(update|cancel))?$/)
  if (taskMatch) return taskGatewayRoute(request, service, gateways, taskMatch)
  const match = url.pathname.match(/^\/api\/agent-resources\/mcp\/([^/]+)\/(tools|apps)(?:\/([^/]+))?$/)
  if (!match) return null
  return toolGatewayRoute(request, service, gateways, match)
}

async function taskGatewayRoute(request: Request, service: AgentResourceService, gateways: McpGatewayPool, match: RegExpMatchArray) {
  const connection = await gateways.connection(service.mcpServer(decodeURIComponent(match[1]!)))
  const taskId = decodeURIComponent(match[2]!)
  if (request.method === 'GET' && !match[3]) return response(200, await connection.task(taskId))
  if (request.method === 'POST' && match[3] === 'update') {
    const input = await readJsonObject(request)
    return response(200, await connection.updateTask(taskId, recordArguments(input.inputResponses)))
  }
  if (request.method === 'POST' && match[3] === 'cancel') return response(200, await connection.cancelTask(taskId))
  return null
}

async function toolGatewayRoute(request: Request, service: AgentResourceService, gateways: McpGatewayPool, match: RegExpMatchArray) {
  const server = service.mcpServer(decodeURIComponent(match[1]!))
  const connection = await gateways.connection(server)
  const tools = await connection.tools()
  if (request.method === 'GET' && match[2] === 'tools' && !match[3])
    return response(200, {
      protocol: connection.protocol,
      tools: tools.tools.map((tool) => ({ ...tool, appResourceUri: toolAppResourceUri(tool) })),
    })
  const toolName = decodeURIComponent(match[3] || '')
  const tool = tools.tools.find((candidate) => candidate.name === toolName)
  if (!tool) return response(404, { error: 'MCP tool not found' })
  if (request.method === 'GET' && match[2] === 'apps') {
    const app = await connection.app(tool)
    return app ? response(200, app) : response(404, { error: 'MCP tool does not provide an App' })
  }
  if (request.method === 'POST' && match[2] === 'tools') {
    const input = await readJsonObject(request)
    return response(
      200,
      await connection.callTool(toolName, recordArguments(input.arguments), tool, {
        signal: request.signal,
        ...(input.inputResponses === undefined ? {} : { inputResponses: recordArguments(input.inputResponses) }),
        ...(typeof input.requestState === 'string' ? { requestState: input.requestState } : {}),
      }),
    )
  }
  return null
}

function recordArguments(value: unknown) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP tool arguments must be an object')
  return value as Record<string, unknown>
}

async function exactRoute(
  request: Request,
  url: URL,
  service: AgentResourceService,
  profilesChanged: () => void,
  gateways: McpGatewayPool,
) {
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
    'POST /api/agent-resources/mcp': async () => {
      const server = service.upsertMcpServer(await readJsonObject(request))
      gateways.invalidate(server.id)
      return server
    },
    'POST /api/agent-resources/plugins': async () => service.installPlugin(await readJsonObject(request)),
    'POST /api/agent-resources/profiles': async () => {
      const profile = service.upsertProfile(await readJsonObject(request))
      profilesChanged()
      return profile
    },
  }
  const handler = routes[`${request.method} ${url.pathname}`]
  return handler ? response(request.method === 'POST' ? 201 : 200, await handler()) : null
}

async function reloadPlugin(id: string, service: AgentResourceService, gateways: McpGatewayPool) {
  const previous = service.catalog().plugins.find((plugin) => plugin.id === id)
  const plugin = await service.reloadPlugin(id)
  for (const serverId of new Set([...(previous?.mcpServerIds || []), ...plugin.mcpServerIds])) gateways.invalidate(serverId)
  return response(200, plugin)
}

function removePlugin(id: string, service: AgentResourceService, gateways: McpGatewayPool) {
  const removed = service.removePlugin(id)
  for (const serverId of removed.mcpServerIds) gateways.invalidate(serverId)
  return response(200, { removed: true })
}

async function pluginRoute(request: Request, url: URL, service: AgentResourceService, gateways: McpGatewayPool) {
  const match = url.pathname.match(/^\/api\/agent-resources\/plugins\/([^/]+)(?:\/(reload))?$/)
  if (!match) return null
  const id = decodeURIComponent(match[1]!)
  const handlers: Record<string, () => Response | Promise<Response>> = {
    'POST reload': () => reloadPlugin(id, service, gateways),
    'DELETE ': () => removePlugin(id, service, gateways),
  }
  return handlers[`${request.method} ${match[2] || ''}`]?.() || null
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

function removalRoute(request: Request, url: URL, service: AgentResourceService, gateways: McpGatewayPool) {
  const resourceMatch = url.pathname.match(/^\/api\/agent-resources\/(skill|mcp)\/([^/]+)$/)
  if (request.method !== 'DELETE' || !resourceMatch) return null
  const resourceKind = kind(resourceMatch[1]!)
  const id = decodeURIComponent(resourceMatch[2]!)
  service.remove(resourceKind, id)
  if (resourceKind === 'mcp') gateways.invalidate(id)
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

import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type McpSubscription,
  type ReadResourceResult,
  type Tool,
  type ElicitResult,
  type ElicitRequest,
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { AgentMcpServer } from '@vertexade/platform-contracts'
import { z } from 'zod'

const appMimeType = 'text/html;profile=mcp-app'
const maximumAppBytes = 2_000_000
const taskResultSchema = z.looseObject({
  resultType: z.string().optional(),
  taskId: z.string().optional(),
  status: z.string().optional(),
  inputRequests: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
})

type UiMetadata = {
  resourceUri?: unknown
  csp?: {
    connectDomains?: unknown
    resourceDomains?: unknown
    frameDomains?: unknown
    baseUriDomains?: unknown
  }
  permissions?: { camera?: unknown; microphone?: unknown; geolocation?: unknown; clipboardWrite?: unknown }
  domain?: unknown
}

type McpAppDescriptor = {
  serverId: string
  toolName: string
  resourceUri: string
  html: string
  csp: {
    connectDomains: string[]
    resourceDomains: string[]
    frameDomains: string[]
    baseUriDomains: string[]
  }
  permissions: { camera: boolean; microphone: boolean; geolocation: boolean; clipboardWrite: boolean }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function safeDomains(value: unknown) {
  return strings(value).map((domain) => {
    const url = new URL(domain)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      throw new Error(`MCP App CSP domain must use HTTPS: ${domain}`)
    return url.origin
  })
}

function uiMetadata(value: unknown): UiMetadata {
  return record(record(value).ui) as UiMetadata
}

export function toolAppResourceUri(tool: Pick<Tool, '_meta'>) {
  const uri = uiMetadata(tool._meta).resourceUri
  if (uri === undefined) return null
  if (typeof uri !== 'string' || !uri.startsWith('ui://')) throw new Error('MCP App resourceUri must use the ui:// scheme')
  return uri
}

function appDescriptor(serverId: string, toolName: string, uri: string, result: ReadResourceResult): McpAppDescriptor {
  const content = result.contents.find((item) => item.uri === uri)
  if (!content || !('text' in content) || content.mimeType !== appMimeType) throw new Error('MCP App resource is missing compliant HTML')
  if (Buffer.byteLength(content.text, 'utf8') > maximumAppBytes) throw new Error('MCP App resource exceeds the 2 MB host limit')
  const ui = uiMetadata(content._meta)
  const csp = ui.csp || {}
  const permissions = ui.permissions || {}
  return {
    serverId,
    toolName,
    resourceUri: uri,
    html: content.text,
    csp: {
      connectDomains: safeDomains(csp.connectDomains),
      resourceDomains: safeDomains(csp.resourceDomains),
      frameDomains: safeDomains(csp.frameDomains),
      baseUriDomains: safeDomains(csp.baseUriDomains),
    },
    permissions: {
      camera: permissions.camera === true || typeof permissions.camera === 'object',
      microphone: permissions.microphone === true || typeof permissions.microphone === 'object',
      geolocation: permissions.geolocation === true || typeof permissions.geolocation === 'object',
      clipboardWrite: permissions.clipboardWrite === true || typeof permissions.clipboardWrite === 'object',
    },
  }
}

function transport(server: AgentMcpServer) {
  if (server.transport === 'stdio')
    return new StdioClientTransport({ command: server.command, args: server.args, env: server.env, stderr: 'pipe' })
  const options = { requestInit: { headers: server.headers } }
  return server.transport === 'http'
    ? new StreamableHTTPClientTransport(new URL(server.url), options)
    : new SSEClientTransport(new URL(server.url), options)
}

class McpGatewayConnection {
  readonly #client: Client
  #subscription: McpSubscription | null = null

  private constructor(
    readonly server: AgentMcpServer,
    client: Client,
  ) {
    this.#client = client
  }

  static async connect(server: AgentMcpServer, options: { elicit?: (request: ElicitRequest['params']) => Promise<ElicitResult> } = {}) {
    const client = new Client(
      { name: 'vertexade', version: '0.0.1' },
      {
        versionNegotiation: { mode: 'auto' },
        capabilities: {
          elicitation: { form: {}, url: {} },
          extensions: {
            'io.modelcontextprotocol/ui': { mimeTypes: [appMimeType] },
            'io.modelcontextprotocol/tasks': {},
          },
        },
        inputRequired: { autoFulfill: false },
        listChanged: {
          tools: { onChanged: () => {} },
          resources: { onChanged: () => {} },
          prompts: { onChanged: () => {} },
        },
      },
    )
    if (options.elicit) client.setRequestHandler('elicitation/create', ({ params }) => options.elicit!(params))
    await client.connect(transport(server))
    return new McpGatewayConnection(server, client)
  }

  get protocol() {
    return { era: this.#client.getProtocolEra(), version: this.#client.getNegotiatedProtocolVersion() }
  }

  async tools() {
    return this.#client.listTools()
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    toolDefinition?: Tool,
    options: { signal?: AbortSignal; inputResponses?: Record<string, unknown>; requestState?: string } = {},
  ): Promise<CallToolResult> {
    return this.#client.callTool(
      {
        name,
        arguments: args,
        ...(options.inputResponses ? { inputResponses: options.inputResponses } : {}),
        ...(options.requestState ? { requestState: options.requestState } : {}),
      },
      { toolDefinition, signal: options.signal, allowInputRequired: true },
    )
  }

  async app(tool: Tool) {
    const uri = toolAppResourceUri(tool)
    if (!uri) return null
    return appDescriptor(this.server.id, tool.name, uri, await this.#client.readResource({ uri }))
  }

  async listen() {
    if (this.#client.getProtocolEra() !== 'modern' || this.#subscription) return this.#subscription
    this.#subscription = await this.#client.listen({ toolsListChanged: true, resourcesListChanged: true, promptsListChanged: true })
    return this.#subscription
  }

  async task(taskId: string) {
    return this.#client.request({ method: 'tasks/get', params: { taskId } }, taskResultSchema)
  }

  async updateTask(taskId: string, inputResponses: Record<string, unknown>) {
    return this.#client.request({ method: 'tasks/update', params: { taskId, inputResponses } }, taskResultSchema)
  }

  async cancelTask(taskId: string) {
    return this.#client.request({ method: 'tasks/cancel', params: { taskId } }, taskResultSchema)
  }

  async close() {
    await this.#subscription?.close()
    this.#subscription = null
    await this.#client.close()
  }
}

type PooledConnection = { fingerprint: string; connection: Promise<McpGatewayConnection> }

/** Keeps one negotiated session per configured server so tasks and subscriptions survive HTTP requests. */
export class McpGatewayPool {
  readonly #connections = new Map<string, PooledConnection>()

  async connection(server: AgentMcpServer) {
    const fingerprint = JSON.stringify(server)
    const current = this.#connections.get(server.id)
    if (current?.fingerprint === fingerprint) return current.connection
    if (current) {
      this.#connections.delete(server.id)
      void current.connection.then((connection) => connection.close()).catch(() => {})
    }
    const connection = McpGatewayConnection.connect(server).then((value) => {
      void value.listen().catch(() => {})
      return value
    })
    connection.catch(() => {
      if (this.#connections.get(server.id)?.connection === connection) this.#connections.delete(server.id)
    })
    this.#connections.set(server.id, { fingerprint, connection })
    return connection
  }

  invalidate(serverId: string) {
    const current = this.#connections.get(serverId)
    if (!current) return
    this.#connections.delete(serverId)
    void current.connection.then((connection) => connection.close()).catch(() => {})
  }
}

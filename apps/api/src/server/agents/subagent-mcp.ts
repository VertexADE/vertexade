import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { resilientFetch } from '@vertexade/platform-server/effect'
import { readResponseBody } from '@vertexade/platform-server/http'

type JsonObject = Record<string, unknown>
type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: JsonObject
}

export const modernProtocolVersion = '2026-07-28'
const legacyProtocolVersion = '2025-06-18'
const serverInfo = { name: 'vertexade-subagents', version: '0.0.1' }
const cacheMetadata = { ttlMs: 60_000, cacheScope: 'private' as const }
const formResourceUri = 'ui://vertexade/form/index.html'
const appMimeType = 'text/html;profile=mcp-app'
const maximumResponseBytes = 250_000
const formInstructions =
  'The form tool is available in every collaboration mode, including Default mode. When you need structured user input, prefer form for questionnaires, multiple questions, choices, or checklists instead of writing a questionnaire in chat. Ask only for information that cannot be inferred safely, keep the form concise, and continue normally when the user cancels it or sends a chat message instead.'

function environment() {
  const apiUrl = String(process.env.VERTEXADE_SUBAGENT_API_URL || '').replace(/\/$/, '')
  const token = String(process.env.VERTEXADE_SUBAGENT_TOKEN || '')
  if (!apiUrl || !token) throw new Error('VertexADE sub-agent MCP configuration is incomplete')
  return { apiUrl, token }
}

async function api(path: string, options: RequestInit = {}) {
  const { apiUrl, token } = environment()
  const url = `${apiUrl}${path}`
  const init: RequestInit = {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
  }
  const response = await resilientFetch({
    service: 'VertexADE sub-agent harness',
    fetch: globalThis.fetch,
    url,
    init,
    timeoutMs: path === '/api/internal/subagents/form' ? null : 65_000,
    attempts: 1,
  })
  const text = (await readResponseBody(response, maximumResponseBytes)).toString('utf8')
  let value: unknown = {}
  try {
    value = JSON.parse(text)
  } catch {
    value = { error: text || `Request failed with ${response.status}` }
  }
  if (!response.ok) {
    const message =
      value && typeof value === 'object' && 'error' in value
        ? String((value as { error?: unknown }).error)
        : `Request failed with ${response.status}`
    throw new Error(message)
  }
  return value as JsonObject
}

export const subagentTools = [
  {
    name: 'form',
    title: 'Ask the user with a form',
    description:
      'Show a form in the current VertexADE thread and wait for the user to submit or cancel it. This tool is available in every collaboration mode, including Default mode. Prefer it over a plain chat questionnaire whenever you need multiple questions, choices, checkboxes, or other structured user input that cannot be inferred safely. Choice fields automatically include an Other text input, so do not add an Other option yourself. The submitted values are returned as Markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short form title.' },
        description: { type: 'string', description: 'Optional explanation of why this input is needed.' },
        fields: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable field identifier.' },
              label: { type: 'string', description: 'User-facing field label.' },
              description: { type: 'string', description: 'Optional help text.' },
              type: { type: 'string', enum: ['text', 'select', 'checkbox'] },
              required: { type: 'boolean', default: true },
              multiline: { type: 'boolean', default: false },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { label: { type: 'string' }, value: { type: 'string' }, description: { type: 'string' } },
                  required: ['label', 'value'],
                  additionalProperties: false,
                },
              },
            },
            required: ['id', 'label', 'type'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'fields'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: formResourceUri } },
  },
  {
    name: 'list_agents',
    title: 'List VertexADE child agents',
    description: 'List the enabled VertexADE agents, models, and reasoning levels available for a delegated child run.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'spawn_agent',
    title: 'Spawn a VertexADE child agent',
    description:
      'Start one bounded child agent in the parent Work item’s shared repository worktree. Choose any listed agent and model. Only one child may run at a time, and the parent must wait. The child cannot delegate again. Returns immediately with a durable run ID.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'A concrete, self-contained task with the exact output the parent needs.',
        },
        title: { type: 'string', description: 'Short label for the delegated task.' },
        agent_id: {
          type: 'string',
          description: 'Enabled agent ID from list_agents. Defaults to the parent provider.',
        },
        model: { type: 'string', description: 'Optional model ID exposed for the selected agent.' },
        reasoning_effort: {
          type: 'string',
          description: 'Optional reasoning level exposed for the selected model.',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'get_agent',
    title: 'Inspect a VertexADE child agent',
    description: 'Read the current state and latest result of a child run created by this parent.',
    inputSchema: {
      type: 'object',
      properties: { run_id: { type: 'integer', minimum: 1 } },
      required: ['run_id'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'wait_agent',
    title: 'Wait for a VertexADE child agent',
    description: 'Wait briefly for a child run to finish. Call again if it remains active.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'integer', minimum: 1 },
        timeout_seconds: { type: 'integer', minimum: 1, maximum: 60, default: 30 },
      },
      required: ['run_id'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'integrate_agent',
    title: 'Accept VertexADE child changes',
    description:
      'Record acceptance of a completed child agent’s changes, which are already present in the shared Work item worktree. Call after validating the child result.',
    inputSchema: {
      type: 'object',
      properties: { run_id: { type: 'integer', minimum: 1 } },
      required: ['run_id'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'cancel_agent',
    title: 'Cancel a VertexADE child agent',
    description: 'Stop an active child run created by this parent.',
    inputSchema: {
      type: 'object',
      properties: { run_id: { type: 'integer', minimum: 1 } },
      required: ['run_id'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
]

function availableTools() {
  return process.env.VERTEXADE_SUBAGENTS_ENABLED !== '0' ? subagentTools : subagentTools.filter((tool) => tool.name === 'form')
}

function argumentsOf(request: JsonRpcRequest) {
  const value = request.params?.arguments
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

async function waitForAgent(input: JsonObject) {
  const runId = Number(input.run_id)
  const timeout = Math.min(60, Math.max(1, Number(input.timeout_seconds) || 30)) * 1_000
  const deadline = Date.now() + timeout
  let result = await api(`/api/internal/subagents/runs/${runId}`)
  while (['starting', 'running'].includes(String(result.status)) && Date.now() < deadline) {
    await new Promise((resolve) => {
      setTimeout(resolve, 500)
    })
    result = await api(`/api/internal/subagents/runs/${runId}`)
  }
  return result
}

async function callTool(name: unknown, input: JsonObject) {
  if (name === 'form') return api('/api/internal/subagents/form', { method: 'POST', body: JSON.stringify(input) })
  if (name === 'list_agents') return api('/api/internal/subagents/agents')
  if (name === 'spawn_agent') {
    return api('/api/internal/subagents/runs', { method: 'POST', body: JSON.stringify(input) })
  }
  if (name === 'get_agent') return api(`/api/internal/subagents/runs/${Number(input.run_id)}`)
  if (name === 'wait_agent') return waitForAgent(input)
  if (name === 'integrate_agent') {
    return api(`/api/internal/subagents/runs/${Number(input.run_id)}/integrate`, { method: 'POST' })
  }
  if (name === 'cancel_agent') {
    return api(`/api/internal/subagents/runs/${Number(input.run_id)}/cancel`, { method: 'POST' })
  }
  throw new Error(`Unknown VertexADE sub-agent tool: ${String(name || '(empty)')}`)
}

function toolResult(value: JsonObject, isError = false) {
  const text = JSON.stringify(value)
  return { content: [{ type: 'text', text }], structuredContent: value, isError }
}

function formElicitation(input: JsonObject) {
  const fields = Array.isArray(input.fields)
    ? input.fields.filter((field): field is JsonObject => Boolean(field && typeof field === 'object'))
    : []
  const properties = Object.fromEntries(
    fields.map((field) => {
      const options = Array.isArray(field.options)
        ? field.options.filter((option): option is JsonObject => Boolean(option && typeof option === 'object'))
        : []
      const values = options.map((option) => String(option.value || option.label || '')).filter(Boolean)
      const base = {
        title: String(field.label || field.id || ''),
        ...(field.description ? { description: String(field.description) } : {}),
      }
      if (field.type === 'checkbox' && values.length)
        return [String(field.id), { ...base, type: 'array', items: { type: 'string', enum: values } }]
      if (field.type === 'checkbox') return [String(field.id), { ...base, type: 'boolean' }]
      if (field.type === 'select') return [String(field.id), { ...base, type: 'string', enum: values }]
      return [String(field.id), { ...base, type: 'string' }]
    }),
  )
  return {
    resultType: 'input_required',
    inputRequests: {
      form: {
        method: 'elicitation/create',
        params: {
          mode: 'form',
          message: [input.title, input.description].filter(Boolean).map(String).join('\n\n'),
          requestedSchema: {
            type: 'object',
            properties,
            required: fields.filter((field) => field.required !== false).map((field) => String(field.id)),
          },
        },
      },
    },
    requestState: JSON.stringify({ tool: 'form' }),
  }
}

function modernFormResponse(request: JsonRpcRequest) {
  if (request.params?.name !== 'form' || !requestProtocolVersion(request)) return null
  const responses = recordValue(request.params.inputResponses)
  if (!Object.keys(responses).length) return modernResult(request, formElicitation(argumentsOf(request)))
  const response = recordValue(responses.form)
  const action = String(response.action || 'cancel')
  const content = recordValue(response.content)
  return modernResult(request, toolResult(action === 'accept' ? content : { [action]: true }))
}

function recordValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

function requestProtocolVersion(request: JsonRpcRequest) {
  const metadata = request.params?._meta
  return metadata && typeof metadata === 'object' ? String((metadata as JsonObject)['io.modelcontextprotocol/protocolVersion'] || '') : ''
}

function modernResult<T extends JsonObject>(request: JsonRpcRequest, result: T): T & JsonObject {
  if (!requestProtocolVersion(request) && request.method !== 'server/discover') return result
  return {
    ...result,
    resultType: result.resultType || 'complete',
    _meta: {
      ...(result._meta && typeof result._meta === 'object' ? result._meta : {}),
      'io.modelcontextprotocol/serverInfo': serverInfo,
    },
  }
}

function formAppHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:light dark;font:15px system-ui}body{margin:0;padding:16px;background:transparent}#root{display:grid;gap:12px}button,input,textarea,select{font:inherit}</style></head><body><div id="root" role="form" aria-live="polite"></div><script>window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/sandbox-resource-ready'},'*')</script></body></html>`
}

class McpRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: JsonObject,
  ) {
    super(message)
  }
}

export async function handleSubagentMcpRequest(request: JsonRpcRequest) {
  if (request.method === 'initialize')
    return {
      protocolVersion: String(request.params?.protocolVersion || legacyProtocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'vertexade-subagents', version: '0.0.1' },
      instructions: formInstructions,
    }
  if (request.method === 'server/discover')
    return modernResult(request, {
      supportedVersions: [modernProtocolVersion, legacyProtocolVersion],
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [appMimeType] } },
      },
      instructions: formInstructions,
      ...cacheMetadata,
    })
  const requestedVersion = requestProtocolVersion(request)
  if (requestedVersion && requestedVersion !== modernProtocolVersion)
    throw new McpRequestError(-32022, 'Unsupported protocol version', {
      supported: [modernProtocolVersion, legacyProtocolVersion],
      requested: requestedVersion,
    })
  if (request.method === 'ping') return {}
  if (request.method === 'tools/list') return modernResult(request, { tools: availableTools(), ...cacheMetadata })
  if (request.method === 'resources/list')
    return modernResult(request, {
      resources: [{ uri: formResourceUri, name: 'VertexADE form', mimeType: appMimeType }],
      ...cacheMetadata,
    })
  if (request.method === 'resources/read') {
    if (request.params?.uri !== formResourceUri) throw new McpRequestError(-32602, 'Unknown resource URI')
    return modernResult(request, {
      contents: [
        {
          uri: formResourceUri,
          mimeType: appMimeType,
          text: formAppHtml(),
          _meta: { ui: { csp: {}, permissions: {} } },
        },
      ],
      ...cacheMetadata,
    })
  }
  if (request.method === 'tools/call') {
    const form = modernFormResponse(request)
    if (form) return form
    try {
      return modernResult(request, toolResult(await callTool(request.params?.name, argumentsOf(request))))
    } catch (error) {
      return modernResult(request, toolResult({ error: error instanceof Error ? error.message : String(error) }, true))
    }
  }
  throw new Error(`Unsupported MCP method: ${request.method}`)
}

function write(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function runSubagentMcpServer() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })
  for await (const line of lines) {
    if (!line.trim()) continue
    let request: JsonRpcRequest
    try {
      request = JSON.parse(line) as JsonRpcRequest
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } })
      continue
    }
    if (request.id === undefined) continue
    try {
      write({ jsonrpc: '2.0', id: request.id, result: await handleSubagentMcpRequest(request) })
    } catch (error) {
      write({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: error instanceof McpRequestError ? error.code : -32601,
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof McpRequestError && error.data ? { data: error.data } : {}),
        },
      })
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runSubagentMcpServer().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

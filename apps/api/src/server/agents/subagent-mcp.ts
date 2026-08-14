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

const protocolVersion = '2025-06-18'
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
  const response = await resilientFetch({
    service: 'VertexADE sub-agent harness',
    fetch: globalThis.fetch,
    url: `${apiUrl}${path}`,
    init: {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...options.headers,
      },
    },
    timeoutMs: path === '/api/internal/subagents/form' ? 86_400_000 : 65_000,
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
      'Show a form in the current VertexADE thread and wait for the user to submit or cancel it. This tool is available in every collaboration mode, including Default mode. Prefer it over a plain chat questionnaire whenever you need multiple questions, choices, checkboxes, or other structured user input that cannot be inferred safely. The submitted values are returned as Markdown.',
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

export async function handleSubagentMcpRequest(request: JsonRpcRequest) {
  if (request.method === 'initialize')
    return {
      protocolVersion: String(request.params?.protocolVersion || protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'vertexade-subagents', version: '0.0.1' },
      instructions: formInstructions,
    }
  if (request.method === 'ping') return {}
  if (request.method === 'tools/list') return { tools: availableTools() }
  if (request.method === 'tools/call') {
    try {
      return toolResult(await callTool(request.params?.name, argumentsOf(request)))
    } catch (error) {
      return toolResult({ error: error instanceof Error ? error.message : String(error) }, true)
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
        error: { code: -32601, message: error instanceof Error ? error.message : String(error) },
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

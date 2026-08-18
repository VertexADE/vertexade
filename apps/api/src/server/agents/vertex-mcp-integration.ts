import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { AgentMcpServer } from '@vertexade/platform-contracts'
import { HttpError, readRequestBody } from '@vertexade/platform-server/http'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, repositories } from '../database/schema/tables.ts'
import { waitForFormResolution } from './form-requests.ts'
import {
  type ChildAgentJob,
  type SubagentHarnessDependencies,
  type SubagentInput,
  SubagentHarness,
  SubagentHarnessError,
  subagentJobRecord,
} from './subagent-harness.ts'
import {
  type VertexFormFieldType,
  vertexFormFieldTypes,
  vertexFormPromptInstruction,
  vertexMcpServerId,
  vertexMcpServerName,
} from './vertex-mcp-contract.ts'

type VertexMcpIntegrationDependencies = {
  database: DrizzleDashboardDatabase
  harness: SubagentHarness
  apiUrl: string
  notify(reason: string, id?: number | null): void
}

class VertexMcpIntegrationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const activeStatuses = ['starting', 'running']
const terminalStatuses = ['completed', 'failed', 'cancelled', 'resumable']

function vertexMcpParentRecord(row: typeof jobs.$inferSelect, fullName: string) {
  return {
    ...subagentJobRecord(row, fullName),
    input_questions: row.inputQuestions,
    allow_subagents: row.allowSubagents,
    subagent_token_hash: row.subagentTokenHash,
    subagent_token_expires_at: row.subagentTokenExpiresAt,
  }
}

type VertexMcpParent = ReturnType<typeof vertexMcpParentRecord>

function requiredText(value: unknown, maximum: number, name: string) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) throw new VertexMcpIntegrationError(`${name} is required`)
  if (result.length > maximum) throw new VertexMcpIntegrationError(`${name} exceeds ${maximum.toLocaleString()} characters`)
  return result
}

function optionalText(value: unknown, maximum: number, name: string) {
  if (value === undefined || value === null || value === '') return ''
  return requiredText(value, maximum, name)
}

function tokenHash(value: string) {
  return createHash('sha256').update(value).digest()
}

function safeHashMatch(expected: unknown, token: string) {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) return false
  const expectedBuffer = Buffer.from(expected, 'hex')
  const actualBuffer = tokenHash(token)
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
}

function isVertexFormFieldType(value: string): value is VertexFormFieldType {
  return (vertexFormFieldTypes as readonly string[]).includes(value)
}

function formFieldType(value: unknown, id: string): VertexFormFieldType {
  const type = String(value || '')
  if (!isVertexFormFieldType(type)) throw new VertexMcpIntegrationError(`Form field ${id} has an invalid type`)
  return type
}

function formFieldOptions(value: unknown, id: string) {
  if (!Array.isArray(value)) return []
  return value.map((option, index) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      throw new VertexMcpIntegrationError(`Option ${index + 1} for ${id} is invalid`)
    }
    const candidate = option as SubagentInput
    return {
      label: requiredText(candidate.label, 200, `Option ${index + 1} label`),
      value: requiredText(candidate.value, 200, `Option ${index + 1} value`),
      description: optionalText(candidate.description, 500, `Option ${index + 1} description`),
    }
  })
}

function formFieldId(value: SubagentInput, index: number, identifiers: Set<string>) {
  const id = requiredText(value.id, 100, `Form field ${index + 1} ID`)
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) throw new VertexMcpIntegrationError(`Form field ID ${id} is invalid`)
  if (identifiers.has(id)) throw new VertexMcpIntegrationError(`Form field ID ${id} is duplicated`)
  identifiers.add(id)
  return id
}

function formFieldMultiline(type: VertexFormFieldType, value: SubagentInput) {
  if (type === 'textarea') return true
  return type === 'text' && value.multiline === true
}

function formQuestion(field: unknown, index: number, title: string, description: string, identifiers: Set<string>) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    throw new VertexMcpIntegrationError(`Form field ${index + 1} is invalid`)
  }
  const value = field as SubagentInput
  const id = formFieldId(value, index, identifiers)
  const type = formFieldType(value.type, id)
  const options = formFieldOptions(value.options, id)
  if (['select', 'checkbox'].includes(type) && !options.length) {
    throw new VertexMcpIntegrationError(`Form field ${id} requires options`)
  }
  return {
    id,
    header: index === 0 ? title : '',
    question: requiredText(value.label, 500, `Form field ${id} label`),
    description: optionalText(value.description, 1_000, `Form field ${id} description`),
    type,
    required: value.required !== false,
    multiline: formFieldMultiline(type, value),
    isSecret: type === 'password',
    options,
    formTitle: title,
    formDescription: description,
  }
}

function statusPayload(child: ChildAgentJob) {
  return {
    run_id: child.id,
    parent_run_id: child.source_job_id,
    status: child.status,
    title: child.task_title,
    agent_id: child.agent_id,
    agent_name: child.agent_name,
    model: child.agent_model,
    reasoning_effort: child.agent_reasoning_effort,
    latest_activity: child.latest_activity,
    result: child.result_text || null,
    created_at: child.created_at,
    finished_at: child.finished_at,
    terminal: terminalStatuses.includes(child.status),
    thread_url: `/threads?thread=${child.id}`,
    branch: child.branch_name,
    workspace: child.worktree_path,
    integrated_at: child.subagent_integrated_at || null,
  }
}

export class VertexMcpIntegration {
  readonly #database: DrizzleDashboardDatabase
  readonly #harness: SubagentHarness
  readonly #apiUrl: string
  readonly #notify: VertexMcpIntegrationDependencies['notify']
  readonly #mcpScript = process.env.VERTEXADE_SUBAGENT_MCP_SCRIPT || fileURLToPath(new URL('./subagent-mcp.ts', import.meta.url))

  constructor(dependencies: VertexMcpIntegrationDependencies) {
    this.#database = dependencies.database
    this.#harness = dependencies.harness
    this.#apiUrl = dependencies.apiUrl.replace(/\/$/, '')
    this.#notify = dependencies.notify
  }

  decorateLaunch(jobId: number, launch: Record<string, unknown>) {
    const allowed = launch.allowSubagents === true
    const token = `${jobId}.${randomBytes(32).toString('base64url')}`
    this.#database
      .update(jobs)
      .set({
        allowSubagents: allowed ? 1 : 0,
        subagentTokenHash: tokenHash(token).toString('hex'),
        subagentTokenExpiresAt: sql`datetime('now', '+24 hours')`,
      })
      .where(eq(jobs.id, jobId))
      .run()
    const builtIn: AgentMcpServer = {
      id: vertexMcpServerId,
      name: vertexMcpServerName,
      transport: 'stdio',
      command: process.execPath,
      args: [...(process.env.VERTEXADE_BUNDLED_RUNTIME === '1' ? [] : ['--import', import.meta.resolve('tsx')]), this.#mcpScript],
      env: {
        VERTEXADE_SUBAGENT_API_URL: this.#apiUrl,
        VERTEXADE_SUBAGENT_TOKEN: token,
        VERTEXADE_SUBAGENTS_ENABLED: allowed ? '1' : '0',
      },
      defaultEnabled: true,
    }
    const configured = Array.isArray(launch.mcpServers) ? (launch.mcpServers as AgentMcpServer[]) : []
    return {
      ...launch,
      ...(typeof launch.prompt === 'string' ? { prompt: `${launch.prompt.trim()}\n\n${vertexFormPromptInstruction}` } : {}),
      mcpServers: [builtIn, ...configured.filter((server) => server.id !== vertexMcpServerId && server.name !== vertexMcpServerName)],
    }
  }

  #authorizedParent(request: Request, requireSubagents: boolean) {
    const authorization = request.headers.get('authorization') || ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    const parentId = Number(token.split('.', 1)[0])
    if (!token || !Number.isInteger(parentId) || parentId < 1) {
      throw new VertexMcpIntegrationError('Invalid sub-agent capability', 401)
    }
    const storedParent = this.#database
      .select({ job: jobs, fullName: repositories.fullName })
      .from(jobs)
      .innerJoin(repositories, eq(repositories.id, jobs.repoId))
      .where(eq(jobs.id, parentId))
      .get()
    const parent = storedParent ? vertexMcpParentRecord(storedParent.job, storedParent.fullName) : undefined
    if (!parent || (requireSubagents && !parent.allow_subagents) || !safeHashMatch(parent.subagent_token_hash, token)) {
      throw new VertexMcpIntegrationError('Invalid sub-agent capability', 401)
    }
    if (!activeStatuses.includes(parent.status)) throw new VertexMcpIntegrationError('The parent run is no longer active', 409)
    if (parent.subagent_token_expires_at && Date.parse(`${parent.subagent_token_expires_at}Z`) <= Date.now()) {
      throw new VertexMcpIntegrationError('The sub-agent capability expired', 401)
    }
    return parent
  }

  async #readJsonObject(request: Request) {
    const payload = await readRequestBody(request)
    let input: unknown
    try {
      input = JSON.parse(payload.toString('utf8') || '{}')
    } catch {
      throw new VertexMcpIntegrationError('Request body must contain valid JSON')
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VertexMcpIntegrationError('Request body must be a JSON object')
    }
    return input as SubagentInput
  }

  #formQuestions(input: SubagentInput) {
    const title = requiredText(input.title, 200, 'Form title')
    const description = optionalText(input.description, 2_000, 'Form description')
    if (!Array.isArray(input.fields) || !input.fields.length || input.fields.length > 20) {
      throw new VertexMcpIntegrationError('A form requires between 1 and 20 fields')
    }
    const identifiers = new Set<string>()
    return input.fields.map((field, index) => formQuestion(field, index, title, description, identifiers))
  }

  async #form(parent: VertexMcpParent, input: SubagentInput, signal: AbortSignal) {
    if (parent.input_questions) throw new VertexMcpIntegrationError('This thread already has a pending input request', 409)
    const requestId = `form:${randomUUID()}`
    const questions = this.#formQuestions(input)
    const inserted = this.#database
      .update(jobs)
      .set({
        inputRequestId: JSON.stringify(requestId),
        inputQuestions: JSON.stringify(questions),
        inputRequestedAt: sql`CURRENT_TIMESTAMP`,
        latestActivity: 'Waiting for your form response',
        activityAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(jobs.id, parent.id), isNull(jobs.inputQuestions)))
      .run()
    if (!inserted.changes) throw new VertexMcpIntegrationError('This thread already has a pending input request', 409)
    const resolution = waitForFormResolution(requestId, parent.id, signal)
    this.#notify('input_required', parent.id)
    const result = await resolution
    if (signal.aborted) {
      this.#database
        .update(jobs)
        .set({ inputRequestId: null, inputQuestions: null, inputRequestedAt: null })
        .where(and(eq(jobs.id, parent.id), eq(jobs.inputRequestId, JSON.stringify(requestId))))
        .run()
    }
    return result
  }

  async #getRoute(pathname: string, parent: VertexMcpParent) {
    if (pathname === '/api/internal/subagents/agents') {
      return Response.json({ parent_run_id: parent.id, agents: await this.#harness.availableAgents() })
    }
    const match = pathname.match(/^\/api\/internal\/subagents\/runs\/(\d+)$/)
    if (match) return Response.json(statusPayload(this.#harness.child(parent.id, Number(match[1]))))
    return Response.json({ error: 'Sub-agent route not found' }, { status: 404 })
  }

  async #postRoute(request: Request, pathname: string, parent: VertexMcpParent) {
    if (pathname === '/api/internal/subagents/form') {
      return Response.json(await this.#form(parent, await this.#readJsonObject(request), request.signal))
    }
    if (pathname === '/api/internal/subagents/runs') {
      return Response.json(statusPayload(await this.#harness.spawn(parent, await this.#readJsonObject(request))), { status: 202 })
    }
    const cancelMatch = pathname.match(/^\/api\/internal\/subagents\/runs\/(\d+)\/cancel$/)
    if (cancelMatch) {
      const result = this.#harness.cancel(parent.id, Number(cancelMatch[1]))
      return Response.json({ run_id: result.child.id, accepted: result.accepted, status: 'cancelling' }, { status: 202 })
    }
    const integrateMatch = pathname.match(/^\/api\/internal\/subagents\/runs\/(\d+)\/integrate$/)
    if (integrateMatch) {
      const result = await this.#harness.integrate(parent, Number(integrateMatch[1]))
      return Response.json({
        run_id: result.child.id,
        integrated: true,
        already_integrated: result.alreadyIntegrated,
        ...result.result,
      })
    }
    return Response.json({ error: 'Sub-agent route not found' }, { status: 404 })
  }

  async #authorizedRoute(request: Request, pathname: string, parent: VertexMcpParent) {
    if (request.method === 'GET') return this.#getRoute(pathname, parent)
    if (request.method === 'POST') return this.#postRoute(request, pathname, parent)
    return Response.json({ error: 'Sub-agent route not found' }, { status: 404 })
  }

  async dispatch(request: Request) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/internal/subagents/')) return null
    try {
      const parent = this.#authorizedParent(request, url.pathname !== '/api/internal/subagents/form')
      return await this.#authorizedRoute(request, url.pathname, parent)
    } catch (error) {
      const status =
        error instanceof VertexMcpIntegrationError || error instanceof SubagentHarnessError
          ? error.status
          : error instanceof HttpError
            ? error.status
            : 500
      if (status === 500) console.error('VertexADE MCP integration failed:', error)
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status })
    }
  }
}

export function createVertexMcpIntegration(dependencies: Omit<VertexMcpIntegrationDependencies, 'harness'> & SubagentHarnessDependencies) {
  return new VertexMcpIntegration({ ...dependencies, harness: new SubagentHarness(dependencies) })
}

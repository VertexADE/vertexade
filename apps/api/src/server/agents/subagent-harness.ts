import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Agent, AgentMcpServer } from '@vertexade/platform-contracts'
import { HttpError, readRequestBody } from '@vertexade/platform-server/http'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, repositories } from '../database/schema/tables.ts'
import type { AgentRegistry } from './registry.ts'
import { waitForFormResolution } from './form-requests.ts'

type JsonObject = Record<string, unknown>

function subagentJobRecord(row: typeof jobs.$inferSelect, fullName?: string) {
  return {
    id: row.id,
    repo_id: row.repoId,
    pr_number: row.prNumber,
    status: row.status,
    source_job_id: row.sourceJobId,
    work_item_id: row.workItemId,
    agent_id: row.agentId,
    agent_model: row.agentModel,
    agent_reasoning_effort: row.agentReasoningEffort,
    task_title: row.taskTitle,
    branch_name: row.branchName,
    worktree_path: row.worktreePath,
    base_repo_path: row.baseRepoPath,
    latest_activity: row.latestActivity,
    input_questions: row.inputQuestions,
    result_text: row.resultText,
    created_at: row.createdAt,
    finished_at: row.finishedAt,
    allow_subagents: row.allowSubagents,
    subagent_token_hash: row.subagentTokenHash,
    subagent_token_expires_at: row.subagentTokenExpiresAt,
    subagent_integrated_at: row.subagentIntegratedAt,
    full_name: fullName,
  }
}
type ChildSelection = {
  task: string
  title: string
  agentId: string
  model: string
  reasoningEffort: string
}
type ChildWorkspace = {
  worktree: string
  sessionCwd: string
  baseGitDir: string
  baselineSha: string
  branchName: string | null
}

type Dependencies = {
  database: DrizzleDashboardDatabase
  agents: AgentRegistry
  activeJobs: Map<number, { pid?: number; kill(signal?: NodeJS.Signals): boolean }>
  cancellingJobs: Set<number>
  logsRoot: string
  apiUrl: string
  notify(reason: string, id?: number | null): void
  resolveLaunch(workItemId: number | null, prompt: string, agentId: string): Promise<{ prompt: string }>
  createWorkspace(parent: any, runtimeAgent: Readonly<Agent>, title: string): Promise<ChildWorkspace>
  discardWorkspace(parent: any, workspace: ChildWorkspace): Promise<void>
  integrateWorkspace(parent: any, child: any): Promise<{ applied: boolean; files: string[] }>
  startChild(options: {
    jobId: number
    logPath: string
    runtimeAgent: Readonly<Agent>
    userMessage: string
    launch: Record<string, unknown>
  }): unknown
}

class HarnessError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const activeStatuses = ['starting', 'running']
const terminalStatuses = ['completed', 'failed', 'cancelled', 'resumable']
const toolServerName = 'vertexade-subagents'
const maximumChildrenPerParent = 16
const maximumActiveChildrenPerParent = 1
const maximumActiveChildren = 12

function text(value: unknown, maximum: number, name: string) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) throw new HarnessError(`${name} is required`)
  if (result.length > maximum) throw new HarnessError(`${name} exceeds ${maximum.toLocaleString()} characters`)
  return result
}

function optionalText(value: unknown, maximum: number, name: string) {
  if (value === undefined || value === null || value === '') return ''
  return text(value, maximum, name)
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

function publicModel(model: unknown) {
  if (!model || typeof model !== 'object') return null
  const value = model as JsonObject
  const id = String(value.id || '').trim()
  if (!id) return null
  return {
    id,
    name: String(value.name || id),
    description: String(value.description || ''),
    default_reasoning_effort: String(value.default_reasoning_effort || ''),
    reasoning_efforts: Array.isArray(value.reasoning_efforts)
      ? value.reasoning_efforts.flatMap((effort) => {
          if (!effort || typeof effort !== 'object') return []
          const effortId = String((effort as JsonObject).id || '').trim()
          return effortId ? [{ id: effortId, description: String((effort as JsonObject).description || '') }] : []
        })
      : [],
  }
}

function childPrompt(parent: any, selection: ChildSelection) {
  return `<vertexade_subagent>
You are an implementation-capable child agent delegated by VertexADE parent run #${parent.id}.

Bounded task:
${selection.task}

Repository: ${parent.full_name}
You share the parent Work item's existing writable repository worktree.

Complete the bounded task directly in the shared worktree. The parent must wait while you work, and VertexADE permits only one active child for this parent. You may edit files and run relevant checks, but do not publish, mutate external systems, launch more agents, or ask the user questions. Return a concise summary of the changes and validation; the parent will validate the changes already present in its worktree.
</vertexade_subagent>`
}

function statusPayload(child: any) {
  return {
    run_id: child.id,
    parent_run_id: child.source_job_id,
    status: child.status,
    title: child.task_title,
    agent_id: child.agent_id,
    agent_name: child.agent_name || child.agent_id,
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

export class SubagentHarness {
  readonly #database: DrizzleDashboardDatabase
  readonly #agents: AgentRegistry
  readonly #activeJobs: Dependencies['activeJobs']
  readonly #cancellingJobs: Set<number>
  readonly #logsRoot: string
  readonly #apiUrl: string
  readonly #notify: Dependencies['notify']
  readonly #resolveLaunch: Dependencies['resolveLaunch']
  readonly #createWorkspace: Dependencies['createWorkspace']
  readonly #discardWorkspace: Dependencies['discardWorkspace']
  readonly #integrateWorkspace: Dependencies['integrateWorkspace']
  readonly #startChild: Dependencies['startChild']
  readonly #pendingByParent = new Map<number, number>()
  #pendingTotal = 0
  readonly #mcpScript = process.env.VERTEXADE_SUBAGENT_MCP_SCRIPT || fileURLToPath(new URL('./subagent-mcp.ts', import.meta.url))

  constructor(dependencies: Dependencies) {
    this.#database = dependencies.database
    this.#agents = dependencies.agents
    this.#activeJobs = dependencies.activeJobs
    this.#cancellingJobs = dependencies.cancellingJobs
    this.#logsRoot = dependencies.logsRoot
    this.#apiUrl = dependencies.apiUrl.replace(/\/$/, '')
    this.#notify = dependencies.notify
    this.#resolveLaunch = dependencies.resolveLaunch
    this.#createWorkspace = dependencies.createWorkspace
    this.#discardWorkspace = dependencies.discardWorkspace
    this.#integrateWorkspace = dependencies.integrateWorkspace
    this.#startChild = dependencies.startChild
  }

  decorateLaunch(jobId: number, launch: Record<string, unknown>) {
    const allowed = launch.allowSubagents === true
    const token = `${jobId}.${randomBytes(32).toString('base64url')}`
    this.#database
      .update(jobs)
      .set({
        allowSubagents: 1,
        subagentTokenHash: tokenHash(token).toString('hex'),
        subagentTokenExpiresAt: sql`datetime('now', '+24 hours')`,
      })
      .where(eq(jobs.id, jobId))
      .run()
    const builtIn: AgentMcpServer = {
      id: 'vertexade:subagents',
      name: toolServerName,
      transport: 'stdio',
      command: process.execPath,
      args: [...(process.env.VERTEXADE_BUNDLED_RUNTIME === '1' ? [] : ['--import', import.meta.resolve('tsx')]), this.#mcpScript],
      env: {
        VERTEXADE_SUBAGENT_API_URL: this.#apiUrl,
        VERTEXADE_SUBAGENT_TOKEN: token,
        VERTEXADE_SUBAGENTS_ENABLED: allowed ? '1' : '0',
      },
      defaultEnabled: false,
    }
    const configured = Array.isArray(launch.mcpServers) ? (launch.mcpServers as AgentMcpServer[]) : []
    return {
      ...launch,
      mcpServers: [builtIn, ...configured.filter((server) => server.name !== toolServerName)],
    }
  }

  #authorizedParent(request: Request, requireSubagents: boolean) {
    const authorization = request.headers.get('authorization') || ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    const parentId = Number(token.split('.', 1)[0])
    if (!token || !Number.isInteger(parentId) || parentId < 1) throw new HarnessError('Invalid sub-agent capability', 401)
    const storedParent = this.#database
      .select({ job: jobs, fullName: repositories.fullName })
      .from(jobs)
      .innerJoin(repositories, eq(repositories.id, jobs.repoId))
      .where(eq(jobs.id, parentId))
      .get()
    const parent = storedParent ? subagentJobRecord(storedParent.job, storedParent.fullName) : undefined
    if (!parent || (requireSubagents && !parent.allow_subagents) || !safeHashMatch(parent.subagent_token_hash, token)) {
      throw new HarnessError('Invalid sub-agent capability', 401)
    }
    if (!activeStatuses.includes(parent.status)) throw new HarnessError('The parent run is no longer active', 409)
    if (parent.subagent_token_expires_at && Date.parse(`${parent.subagent_token_expires_at}Z`) <= Date.now()) {
      throw new HarnessError('The sub-agent capability expired', 401)
    }
    return parent
  }

  async #availableAgents() {
    const capabilities = this.#agents.capabilities().filter((agent) => agent.enabled && agent.selectable && !agent.preset)
    return Promise.all(
      capabilities.map(async (capability) => {
        const agent = this.#agents.require(capability.id)
        let models: unknown[] = []
        try {
          const options = agent.launchOptions ? await agent.launchOptions({ environment: agent.environment?.() || {} }) : {}
          models = Array.isArray(options.models) ? options.models : []
        } catch {}
        return {
          id: agent.id,
          name: agent.name,
          models: models.map(publicModel).filter(Boolean),
        }
      }),
    )
  }

  async #selection(parent: any, input: JsonObject): Promise<ChildSelection> {
    for (const key of Object.keys(input)) {
      if (!['task', 'title', 'agent_id', 'model', 'reasoning_effort'].includes(key)) {
        throw new HarnessError(`Unknown child-agent option: ${key}`)
      }
    }
    const task = text(input.task, 50_000, 'Child task')
    const title = optionalText(input.title, 200, 'Child title') || task.split(/\r?\n/, 1)[0]!.slice(0, 120)
    const agentId = optionalText(input.agent_id, 200, 'Agent ID') || String(parent.agent_id)
    const available = await this.#availableAgents()
    const agent = available.find((candidate) => candidate.id === agentId)
    if (!agent) throw new HarnessError('Choose an enabled writable child agent')
    const model = optionalText(input.model, 500, 'Model')
    const selectedModel = agent.models.find((candidate) => candidate?.id === model)
    if (model && agent.models.length && !selectedModel) throw new HarnessError(`Model is not available for ${agent.name}`)
    const reasoningEffort = optionalText(input.reasoning_effort, 100, 'Reasoning effort')
    if (
      reasoningEffort &&
      selectedModel?.reasoning_efforts.length &&
      !selectedModel.reasoning_efforts.some((effort) => effort.id === reasoningEffort)
    ) {
      throw new HarnessError(`Reasoning effort is not available for ${model}`)
    }
    return { task, title, agentId, model, reasoningEffort }
  }

  #assertCapacity(parentId: number) {
    const total = Number(
      this.#database
        .select({ count: count() })
        .from(jobs)
        .where(and(eq(jobs.sourceJobId, parentId), eq(jobs.kind, 'subagent')))
        .get()?.count || 0,
    )
    if (total >= maximumChildrenPerParent)
      throw new HarnessError(`A parent run can create at most ${maximumChildrenPerParent} child agents`, 409)
    const activeForParent = Number(
      this.#database
        .select({ count: count() })
        .from(jobs)
        .where(and(eq(jobs.sourceJobId, parentId), eq(jobs.kind, 'subagent'), inArray(jobs.status, activeStatuses)))
        .get()?.count || 0,
    )
    if (activeForParent + (this.#pendingByParent.get(parentId) || 0) >= maximumActiveChildrenPerParent) {
      throw new HarnessError(`Wait for one of the ${maximumActiveChildrenPerParent} active child agents to finish`, 409)
    }
    const activeTotal = Number(
      this.#database
        .select({ count: count() })
        .from(jobs)
        .where(and(eq(jobs.kind, 'subagent'), inArray(jobs.status, activeStatuses)))
        .get()?.count || 0,
    )
    if (activeTotal + this.#pendingTotal >= maximumActiveChildren)
      throw new HarnessError('VertexADE is at its active child-agent limit', 409)
  }

  #reserveCapacity(parentId: number) {
    this.#assertCapacity(parentId)
    this.#pendingByParent.set(parentId, (this.#pendingByParent.get(parentId) || 0) + 1)
    this.#pendingTotal += 1
    return () => {
      const remaining = (this.#pendingByParent.get(parentId) || 1) - 1
      if (remaining) this.#pendingByParent.set(parentId, remaining)
      else this.#pendingByParent.delete(parentId)
      this.#pendingTotal -= 1
    }
  }

  async #spawn(parent: any, input: JsonObject) {
    const releaseCapacity = this.#reserveCapacity(parent.id)
    let workspace: ChildWorkspace | null = null
    let started = false
    try {
      const selection = await this.#selection(parent, input)
      const runtimeAgent = this.#agents.require(selection.agentId)
      workspace = await this.#createWorkspace(parent, runtimeAgent, selection.title)
      const delegatedPrompt = childPrompt(parent, selection)
      const resolved = await this.#resolveLaunch(parent.work_item_id, delegatedPrompt, runtimeAgent.id)
      const stamp = new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 17)
      const workItemKey = `W-${String(parent.work_item_id).padStart(4, '0')}`
      const logPath = join(this.#logsRoot, `${workItemKey}--subagent-${parent.id}-${stamp}.log`)
      const inserted = this.#database
        .insert(jobs)
        .values({
          repoId: parent.repo_id,
          prNumber: parent.pr_number,
          prompt: resolved.prompt,
          worktreePath: workspace.worktree,
          sessionCwd: workspace.sessionCwd,
          workspaceMode: 'combined',
          logPath,
          status: 'starting',
          baseRepoPath: parent.base_repo_path,
          baseGitDir: workspace.baseGitDir,
          headSha: workspace.baselineSha,
          latestActivity: `Starting delegated ${runtimeAgent.name} task…`,
          activityAt: sql`CURRENT_TIMESTAMP`,
          kind: 'subagent',
          sourceJobId: parent.id,
          taskTitle: selection.title,
          branchName: workspace.branchName,
          workItemId: parent.work_item_id,
          agentModel: selection.model || null,
          agentReasoningEffort: selection.reasoningEffort || null,
          ephemeral: runtimeAgent.supportsEphemeral ? 1 : 0,
          allowSubagents: 0,
        })
        .run()
      const jobId = Number(inserted.lastInsertRowid)
      this.#database.update(jobs).set({ subagentBaseSha: workspace.baselineSha }).where(eq(jobs.id, jobId)).run()
      try {
        this.#startChild({
          jobId,
          logPath,
          runtimeAgent,
          userMessage: selection.task,
          launch: {
            jobId,
            cwd: workspace.sessionCwd,
            base: parent.base_repo_path,
            prompt: resolved.prompt,
            reviewMode: false,
            model: selection.model || null,
            reasoningEffort: selection.reasoningEffort || null,
            ephemeral: Boolean(runtimeAgent.supportsEphemeral),
            allowSubagents: false,
            writableRoots: [],
            mcpServers: [],
          },
        })
      } catch (error) {
        this.#database
          .update(jobs)
          .set({
            status: 'failed',
            exitCode: 1,
            finishedAt: sql`CURRENT_TIMESTAMP`,
            latestActivity: error instanceof Error ? error.message : String(error),
            activityAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(jobs.id, jobId))
          .run()
        throw error
      }
      started = true
      this.#notify('subagent_started', jobId)
      return statusPayload(this.#child(parent.id, jobId))
    } finally {
      releaseCapacity()
      if (workspace && !started) await this.#discardWorkspace(parent, workspace).catch(() => undefined)
    }
  }

  #child(parentId: number, childId: number) {
    const storedChild = this.#database
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, childId), eq(jobs.sourceJobId, parentId), eq(jobs.kind, 'subagent')))
      .get()
    if (!storedChild) throw new HarnessError('Child agent not found', 404)
    const child = subagentJobRecord(storedChild)
    const runtimeAgent = this.#agents.get(child.agent_id)
    return { ...child, agent_name: runtimeAgent?.name || child.agent_id }
  }

  #cancel(parentId: number, childId: number) {
    const child = this.#child(parentId, childId)
    if (!activeStatuses.includes(child.status)) throw new HarnessError('The child agent is not active', 409)
    const childProcess = this.#activeJobs.get(child.id)
    if (!childProcess) throw new HarnessError('The child process is no longer attached to VertexADE', 409)
    this.#cancellingJobs.add(child.id)
    this.#database
      .update(jobs)
      .set({ latestActivity: 'Stopping by parent request…', activityAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(jobs.id, Number(child.id)))
      .run()
    try {
      if (childProcess.pid) process.kill(-childProcess.pid, 'SIGTERM')
      else childProcess.kill('SIGTERM')
    } catch {
      try {
        childProcess.kill('SIGTERM')
      } catch (error) {
        this.#cancellingJobs.delete(child.id)
        throw new HarnessError(error instanceof Error ? error.message : String(error), 409)
      }
    }
    this.#notify('subagent_cancelling', child.id)
    return { run_id: child.id, accepted: true, status: 'cancelling' }
  }

  async #integrate(parent: any, childId: number) {
    const child = this.#child(parent.id, childId)
    if (child.status !== 'completed') throw new HarnessError('Wait for the child agent to complete before integrating it', 409)
    if (child.subagent_integrated_at) {
      return { run_id: child.id, integrated: true, already_integrated: true, files: [] }
    }
    const result = await this.#integrateWorkspace(parent, child)
    this.#database
      .update(jobs)
      .set({ subagentIntegratedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(jobs.id, Number(child.id)))
      .run()
    this.#notify('subagent_integrated', child.id)
    return { run_id: child.id, integrated: true, already_integrated: false, ...result }
  }

  async #readJsonObject(request: Request) {
    const payload = await readRequestBody(request)
    let input: unknown
    try {
      input = JSON.parse(payload.toString('utf8') || '{}')
    } catch {
      throw new HarnessError('Request body must contain valid JSON')
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new HarnessError('Request body must be a JSON object')
    }
    return input as JsonObject
  }

  #formQuestions(input: JsonObject) {
    const title = text(input.title, 200, 'Form title')
    const description = optionalText(input.description, 2_000, 'Form description')
    if (!Array.isArray(input.fields) || !input.fields.length || input.fields.length > 20) {
      throw new HarnessError('A form requires between 1 and 20 fields')
    }
    const identifiers = new Set<string>()
    const questions = input.fields.map((field, index) => {
      if (!field || typeof field !== 'object' || Array.isArray(field)) throw new HarnessError(`Form field ${index + 1} is invalid`)
      const value = field as JsonObject
      const id = text(value.id, 100, `Form field ${index + 1} ID`)
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) throw new HarnessError(`Form field ID ${id} is invalid`)
      if (identifiers.has(id)) throw new HarnessError(`Form field ID ${id} is duplicated`)
      identifiers.add(id)
      const type = String(value.type || '')
      if (!['text', 'select', 'checkbox'].includes(type)) throw new HarnessError(`Form field ${id} has an invalid type`)
      const options = Array.isArray(value.options)
        ? value.options.map((option, optionIndex) => {
            if (!option || typeof option !== 'object' || Array.isArray(option))
              throw new HarnessError(`Option ${optionIndex + 1} for ${id} is invalid`)
            const candidate = option as JsonObject
            return {
              label: text(candidate.label, 200, `Option ${optionIndex + 1} label`),
              value: text(candidate.value, 200, `Option ${optionIndex + 1} value`),
              description: optionalText(candidate.description, 500, `Option ${optionIndex + 1} description`),
            }
          })
        : []
      if (type !== 'text' && !options.length) throw new HarnessError(`Form field ${id} requires options`)
      return {
        id,
        header: index === 0 ? title : '',
        question: text(value.label, 500, `Form field ${id} label`),
        description: optionalText(value.description, 1_000, `Form field ${id} description`),
        type,
        required: value.required !== false,
        multiline: type === 'text' && value.multiline === true,
        options,
        formTitle: title,
        formDescription: description,
      }
    })
    return questions
  }

  async #form(parent: any, input: JsonObject) {
    if (parent.input_questions) throw new HarnessError('This thread already has a pending input request', 409)
    const requestId = `form:${randomUUID()}`
    const questions = this.#formQuestions(input)
    this.#database
      .update(jobs)
      .set({
        inputRequestId: JSON.stringify(requestId),
        inputQuestions: JSON.stringify(questions),
        inputRequestedAt: sql`CURRENT_TIMESTAMP`,
        latestActivity: 'Waiting for your form response',
        activityAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(jobs.id, parent.id))
      .run()
    this.#notify('input_required', parent.id)
    return waitForFormResolution(requestId, parent.id)
  }

  async #getRoute(pathname: string, parent: any) {
    if (pathname === '/api/internal/subagents/agents') {
      return Response.json({ parent_run_id: parent.id, agents: await this.#availableAgents() })
    }
    const match = pathname.match(/^\/api\/internal\/subagents\/runs\/(\d+)$/)
    if (match) return Response.json(statusPayload(this.#child(parent.id, Number(match[1]))))
    return Response.json({ error: 'Sub-agent route not found' }, { status: 404 })
  }

  async #postRoute(request: Request, pathname: string, parent: any) {
    if (pathname === '/api/internal/subagents/form') return Response.json(await this.#form(parent, await this.#readJsonObject(request)))
    if (pathname === '/api/internal/subagents/runs') {
      return Response.json(await this.#spawn(parent, await this.#readJsonObject(request)), {
        status: 202,
      })
    }
    const cancelMatch = pathname.match(/^\/api\/internal\/subagents\/runs\/(\d+)\/cancel$/)
    if (cancelMatch) {
      return Response.json(this.#cancel(parent.id, Number(cancelMatch[1])), { status: 202 })
    }
    const integrateMatch = pathname.match(/^\/api\/internal\/subagents\/runs\/(\d+)\/integrate$/)
    if (integrateMatch) {
      return Response.json(await this.#integrate(parent, Number(integrateMatch[1])))
    }
    return Response.json({ error: 'Sub-agent route not found' }, { status: 404 })
  }

  async #authorizedRoute(request: Request, pathname: string, parent: any) {
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
      const status = error instanceof HarnessError ? error.status : error instanceof HttpError ? error.status : 500
      if (status === 500) console.error('VertexADE sub-agent harness failed:', error)
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status })
    }
  }
}

import { join } from 'node:path'
import type { Agent } from '@vertexade/platform-contracts'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs } from '../database/schema/tables.ts'
import type { AgentRegistry } from './registry.ts'

export type SubagentInput = Record<string, unknown>

export function subagentJobRecord(row: typeof jobs.$inferSelect, fullName?: string) {
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
    session_cwd: row.sessionCwd,
    base_repo_path: row.baseRepoPath,
    latest_activity: row.latestActivity,
    result_text: row.resultText,
    created_at: row.createdAt,
    finished_at: row.finishedAt,
    subagent_base_sha: row.subagentBaseSha,
    subagent_integrated_at: row.subagentIntegratedAt,
    full_name: fullName,
  }
}
export type SubagentJob = ReturnType<typeof subagentJobRecord>
export type ChildAgentJob = SubagentJob & { agent_name: string }
type IntegrableChildAgentJob = Omit<ChildAgentJob, 'subagent_base_sha'> & { subagent_base_sha: string }
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

export type SubagentHarnessDependencies = {
  database: DrizzleDashboardDatabase
  agents: AgentRegistry
  activeJobs: Map<number, { pid?: number; kill(signal?: NodeJS.Signals): boolean }>
  cancellingJobs: Set<number>
  logsRoot: string
  notify(reason: string, id?: number | null): void
  resolveLaunch(workItemId: number | null, prompt: string, agentId: string): Promise<{ prompt: string }>
  createWorkspace(parent: SubagentJob, runtimeAgent: Readonly<Agent>, title: string): Promise<ChildWorkspace>
  discardWorkspace(parent: SubagentJob, workspace: ChildWorkspace): Promise<void>
  integrateWorkspace(parent: SubagentJob, child: IntegrableChildAgentJob): Promise<{ applied: boolean; files: string[] }>
  startChild(options: {
    jobId: number
    logPath: string
    runtimeAgent: Readonly<Agent>
    userMessage: string
    launch: Record<string, unknown>
  }): unknown
}

export class SubagentHarnessError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const activeStatuses = ['starting', 'running']
const maximumChildrenPerParent = 16
const maximumActiveChildrenPerParent = 1
const maximumActiveChildren = 12

function text(value: unknown, maximum: number, name: string) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) throw new SubagentHarnessError(`${name} is required`)
  if (result.length > maximum) throw new SubagentHarnessError(`${name} exceeds ${maximum.toLocaleString()} characters`)
  return result
}

function optionalText(value: unknown, maximum: number, name: string) {
  if (value === undefined || value === null || value === '') return ''
  return text(value, maximum, name)
}

function publicModel(model: unknown) {
  if (!model || typeof model !== 'object') return null
  const value = model as SubagentInput
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
          const effortId = String((effort as SubagentInput).id || '').trim()
          return effortId ? [{ id: effortId, description: String((effort as SubagentInput).description || '') }] : []
        })
      : [],
  }
}

function childPrompt(parent: SubagentJob, selection: ChildSelection) {
  return `<vertexade_subagent>
You are an implementation-capable child agent delegated by VertexADE parent run #${parent.id}.

Bounded task:
${selection.task}

Repository: ${parent.full_name}
You share the parent Work item's existing writable repository worktree.

Complete the bounded task directly in the shared worktree. The parent must wait while you work, and VertexADE permits only one active child for this parent. You may edit files and run relevant checks, but do not publish, mutate external systems, launch more agents, or ask the user questions. Return a concise summary of the changes and validation; the parent will validate the changes already present in its worktree.
</vertexade_subagent>`
}

export class SubagentHarness {
  readonly #database: DrizzleDashboardDatabase
  readonly #agents: AgentRegistry
  readonly #activeJobs: SubagentHarnessDependencies['activeJobs']
  readonly #cancellingJobs: Set<number>
  readonly #logsRoot: string
  readonly #notify: SubagentHarnessDependencies['notify']
  readonly #resolveLaunch: SubagentHarnessDependencies['resolveLaunch']
  readonly #createWorkspace: SubagentHarnessDependencies['createWorkspace']
  readonly #discardWorkspace: SubagentHarnessDependencies['discardWorkspace']
  readonly #integrateWorkspace: SubagentHarnessDependencies['integrateWorkspace']
  readonly #startChild: SubagentHarnessDependencies['startChild']
  readonly #pendingByParent = new Map<number, number>()
  readonly #integratingChildren = new Set<number>()
  #pendingTotal = 0

  constructor(dependencies: SubagentHarnessDependencies) {
    this.#database = dependencies.database
    this.#agents = dependencies.agents
    this.#activeJobs = dependencies.activeJobs
    this.#cancellingJobs = dependencies.cancellingJobs
    this.#logsRoot = dependencies.logsRoot
    this.#notify = dependencies.notify
    this.#resolveLaunch = dependencies.resolveLaunch
    this.#createWorkspace = dependencies.createWorkspace
    this.#discardWorkspace = dependencies.discardWorkspace
    this.#integrateWorkspace = dependencies.integrateWorkspace
    this.#startChild = dependencies.startChild
  }

  async availableAgents() {
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

  async #selection(parent: SubagentJob, input: SubagentInput): Promise<ChildSelection> {
    for (const key of Object.keys(input)) {
      if (!['task', 'title', 'agent_id', 'model', 'reasoning_effort'].includes(key)) {
        throw new SubagentHarnessError(`Unknown child-agent option: ${key}`)
      }
    }
    const task = text(input.task, 50_000, 'Child task')
    const title = optionalText(input.title, 200, 'Child title') || task.split(/\r?\n/, 1)[0]!.slice(0, 120)
    const agentId = optionalText(input.agent_id, 200, 'Agent ID') || String(parent.agent_id)
    const available = await this.availableAgents()
    const agent = available.find((candidate) => candidate.id === agentId)
    if (!agent) throw new SubagentHarnessError('Choose an enabled writable child agent')
    const model = optionalText(input.model, 500, 'Model')
    const selectedModel = agent.models.find((candidate) => candidate?.id === model)
    if (model && !selectedModel) throw new SubagentHarnessError(`Model is not available for ${agent.name}`)
    const reasoningEffort = optionalText(input.reasoning_effort, 100, 'Reasoning effort')
    if (reasoningEffort && !selectedModel?.reasoning_efforts.some((effort) => effort.id === reasoningEffort)) {
      throw new SubagentHarnessError(`Reasoning effort is not available for ${model}`)
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
      throw new SubagentHarnessError(`A parent run can create at most ${maximumChildrenPerParent} child agents`, 409)
    const activeForParent = Number(
      this.#database
        .select({ count: count() })
        .from(jobs)
        .where(and(eq(jobs.sourceJobId, parentId), eq(jobs.kind, 'subagent'), inArray(jobs.status, activeStatuses)))
        .get()?.count || 0,
    )
    if (activeForParent + (this.#pendingByParent.get(parentId) || 0) >= maximumActiveChildrenPerParent) {
      throw new SubagentHarnessError(`Wait for one of the ${maximumActiveChildrenPerParent} active child agents to finish`, 409)
    }
    const activeTotal = Number(
      this.#database
        .select({ count: count() })
        .from(jobs)
        .where(and(eq(jobs.kind, 'subagent'), inArray(jobs.status, activeStatuses)))
        .get()?.count || 0,
    )
    if (activeTotal + this.#pendingTotal >= maximumActiveChildren)
      throw new SubagentHarnessError('VertexADE is at its active child-agent limit', 409)
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

  async spawn(parent: SubagentJob, input: SubagentInput) {
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
      return this.child(parent.id, jobId)
    } finally {
      releaseCapacity()
      if (workspace && !started) await this.#discardWorkspace(parent, workspace).catch(() => undefined)
    }
  }

  child(parentId: number, childId: number) {
    const storedChild = this.#database
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, childId), eq(jobs.sourceJobId, parentId), eq(jobs.kind, 'subagent')))
      .get()
    if (!storedChild) throw new SubagentHarnessError('Child agent not found', 404)
    const child = subagentJobRecord(storedChild)
    const runtimeAgent = this.#agents.get(child.agent_id)
    return { ...child, agent_name: runtimeAgent?.name || child.agent_id }
  }

  cancel(parentId: number, childId: number) {
    const child = this.child(parentId, childId)
    if (!activeStatuses.includes(child.status)) throw new SubagentHarnessError('The child agent is not active', 409)
    const childProcess = this.#activeJobs.get(child.id)
    if (!childProcess) throw new SubagentHarnessError('The child process is no longer attached to VertexADE', 409)
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
        throw new SubagentHarnessError(error instanceof Error ? error.message : String(error), 409)
      }
    }
    this.#notify('subagent_cancelling', child.id)
    return { child, accepted: true as const }
  }

  async integrate(parent: SubagentJob, childId: number) {
    if (this.#integratingChildren.has(childId)) throw new SubagentHarnessError('The child agent is already being integrated', 409)
    const child = this.child(parent.id, childId)
    if (child.status !== 'completed') throw new SubagentHarnessError('Wait for the child agent to complete before integrating it', 409)
    if (!child.subagent_base_sha) throw new SubagentHarnessError('Child agent workspace baseline is missing', 409)
    if (child.subagent_integrated_at) {
      return { child, alreadyIntegrated: true as const, result: { applied: true, files: [] as string[] } }
    }
    this.#integratingChildren.add(childId)
    try {
      const result = await this.#integrateWorkspace(parent, child)
      this.#database
        .update(jobs)
        .set({ subagentIntegratedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(jobs.id, Number(child.id)))
        .run()
      this.#notify('subagent_integrated', child.id)
      return { child, alreadyIntegrated: false as const, result }
    } finally {
      this.#integratingChildren.delete(childId)
    }
  }
}

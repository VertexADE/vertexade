import type {
  AutomationBoundAction,
  AutomationFlowRun,
  AutomationImprovementItem,
  AutomationPromptStep,
  AutomationRecipe,
  AutomationStep,
  AutomationThreadAction,
  CapabilityValue,
  TriggerEvent,
} from '@vertexade/platform-contracts'
import { and, asc, count, desc, eq, inArray, max, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import {
  automationAuditEvents,
  automationControlEvents,
  automationFlowRuns,
  automationRecipes,
  automationSchedules,
  automationRuntimeControl,
  capabilityExecutions,
  jobFollowUpQueue,
  jobs,
} from '../database/schema/tables.ts'
import type { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import type { CapabilityExecutionService } from './capability-execution.ts'
import { automationConditionsMatch } from './automation-conditions.ts'
import { automationEventIdempotencyKey } from './automation-idempotency.ts'
import {
  auditEventFromRow,
  flowRunFromRow,
  normalizeRecipeInput,
  parseImprovementPlan,
  recipeFromRow,
  recipeThreadLaunchOptions,
  supportsThreadTarget,
  type NormalizedRecipeInput,
  type RecipeInput,
  validateRecipeInput,
} from './automation-recipe-model.ts'
import type { AutomationThreadLaunchOptions, AutomationThreadLaunchResult } from './automation-thread-launcher.ts'
import { AutomationScheduleService, normalizeAutomationSchedule, saveAutomationSchedule } from './automation-schedule-service.ts'
import { replaceTriggerSubscriptions } from './trigger-subscription-swap.ts'
type QueuedPrompt = { automationRunId: number; automationPhase: number }

export class AutomationRecipeService {
  readonly #subscriptions = new Map<string, () => void>()
  readonly #schedules: AutomationScheduleService
  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly registries: PlatformCapabilityRegistries,
    private readonly executions: CapabilityExecutionService,
    private readonly notify: (reason: string, id?: number | null) => void = () => undefined,
    private readonly maximumSteps: () => number = () => 20,
    private readonly maximumConcurrentRuns: () => number = () => 4,
    private readonly launchThread: (
      action: Exclude<AutomationThreadAction, 'none'>,
      prompt: string,
      trigger?: TriggerEvent,
      options?: AutomationThreadLaunchOptions,
    ) => Promise<AutomationThreadLaunchResult> = async () => {
      throw new Error('Automated thread launching is unavailable')
    },
    private readonly queuePrompt: (jobId: number, prompt: string, metadata: QueuedPrompt) => void = () => {
      throw new Error('Automated prompt queueing is unavailable')
    },
  ) {
    this.#schedules = new AutomationScheduleService({
      database,
      notify,
      recipe: (id) => this.get(id),
      execute: (recipe, trigger) => this.runOnce(recipe, trigger),
    })
  }
  list() {
    return this.database
      .select({ recipe: automationRecipes, schedule: automationSchedules })
      .from(automationRecipes)
      .leftJoin(automationSchedules, eq(automationSchedules.recipeId, automationRecipes.id))
      .orderBy(asc(sql`lower(${automationRecipes.name})`), asc(automationRecipes.id))
      .all()
      .map(({ recipe, schedule }) => recipeFromRow(recipe, schedule))
  }

  get(id: number) {
    const row = this.database
      .select({ recipe: automationRecipes, schedule: automationSchedules })
      .from(automationRecipes)
      .leftJoin(automationSchedules, eq(automationSchedules.recipeId, automationRecipes.id))
      .where(eq(automationRecipes.id, id))
      .get()
    return row ? recipeFromRow(row.recipe, row.schedule) : null
  }

  listRuns(limit = 50) {
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 200)
    return this.database
      .select()
      .from(automationFlowRuns)
      .orderBy(desc(automationFlowRuns.id))
      .limit(bounded)
      .all()
      .map((row) => flowRunFromRow(row))
  }

  listAuditEvents(limit = 100) {
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 250)
    return this.database
      .select()
      .from(automationAuditEvents)
      .orderBy(desc(automationAuditEvents.id))
      .limit(bounded)
      .all()
      .map((row) => auditEventFromRow(row))
  }

  getRun(id: number) {
    const row = this.database.select().from(automationFlowRuns).where(eq(automationFlowRuns.id, id)).get()
    return row ? flowRunFromRow(row) : null
  }

  runtimeStatus() {
    const control = this.database
      .select({
        paused: automationRuntimeControl.paused,
        reason: automationRuntimeControl.reason,
        updatedAt: automationRuntimeControl.updatedAt,
      })
      .from(automationRuntimeControl)
      .where(eq(automationRuntimeControl.id, 1))
      .get()!
    const active = this.database.select({ count: count() }).from(automationFlowRuns).where(eq(automationFlowRuns.status, 'running')).get()!
    return {
      paused: Boolean(control.paused),
      reason: String(control.reason || ''),
      updatedAt: control.updatedAt,
      activeRuns: Number(active.count),
      maximumConcurrentRuns: this.maximumConcurrentRuns(),
    }
  }

  setPaused(paused: boolean, reason = '') {
    const current = this.runtimeStatus()
    const normalizedReason = String(reason).trim().slice(0, 500)
    if (current.paused === paused && current.reason === normalizedReason) return current
    this.database
      .update(automationRuntimeControl)
      .set({ paused: paused ? 1 : 0, reason: normalizedReason, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(automationRuntimeControl.id, 1))
      .run()
    this.database
      .insert(automationControlEvents)
      .values({ paused: paused ? 1 : 0, reason: normalizedReason })
      .run()
    this.notify('automation_runtime_updated')
    return this.runtimeStatus()
  }

  save(input: RecipeInput, id?: number) {
    const value = normalizeRecipeInput(input, this.maximumSteps())
    const existing = id ? this.get(id) : null
    const schedule = input.schedule === undefined ? undefined : normalizeAutomationSchedule(input.schedule, this.database)
    if (value.triggerId === 'core.scheduled' && !schedule && !existing?.schedule) {
      throw new Error('Scheduled automations require schedule settings')
    }
    if (value.triggerId !== 'core.scheduled' && schedule) throw new Error('Schedule settings require the scheduled trigger')
    validateRecipeInput(value)
    this.requireCapabilities(value)
    const recipeId = id ? this.update(id, value) : this.insert(value)
    if (!recipeId) return null
    if (schedule) saveAutomationSchedule(this.database, recipeId, schedule)
    else if (value.triggerId !== 'core.scheduled')
      this.database.delete(automationSchedules).where(eq(automationSchedules.recipeId, recipeId)).run()
    this.notify('automation_recipe_updated', recipeId)
    return this.get(recipeId)
  }

  remove(id: number) {
    const result = this.database.delete(automationRecipes).where(eq(automationRecipes.id, id)).run()
    if (result.changes) this.notify('automation_recipe_removed', id)
    return Boolean(result.changes)
  }

  async run(id: number, trigger?: TriggerEvent) {
    const current = this.get(id)
    if (!current) throw new Error('Automation recipe not found')
    if (current.schedule && !trigger) return this.#schedules.run(current, 'manual')
    return this.runOnce(current, trigger)
  }

  private async runOnce(current: AutomationRecipe, trigger?: TriggerEvent) {
    const id = current.id
    const idempotencyKey = automationEventIdempotencyKey(current.triggerId, trigger)
    if (idempotencyKey) {
      const existing = this.database
        .select({ id: automationFlowRuns.id })
        .from(automationFlowRuns)
        .where(and(eq(automationFlowRuns.recipeId, current.id), eq(automationFlowRuns.idempotencyKey, idempotencyKey)))
        .get()
      if (existing) return current
    }
    const runtime = this.runtimeStatus()
    if (runtime.paused) throw new Error(`Automation runtime is paused${runtime.reason ? `: ${runtime.reason}` : ''}`)
    if (runtime.activeRuns >= runtime.maximumConcurrentRuns) {
      throw new Error(`Automation runtime has reached its concurrent flow limit (${runtime.maximumConcurrentRuns})`)
    }
    const created = this.createRun(current, trigger)
    if (!created.created) return current
    const runId = created.id
    this.audit(runId, current.id, 'flow_started', null, {
      origin: trigger ? 'trigger' : 'manual',
      triggerId: current.triggerId,
      subject: trigger?.subject || null,
      threadAction: current.threadAction,
      preflightCapabilities: current.steps.map((step) => `${step.kind}:${step.capabilityId}`),
      externalActions: current.boundActions.map((action) => action.capabilityId),
    })
    this.database
      .update(automationRecipes)
      .set({
        lastRunAt: sql`CURRENT_TIMESTAMP`,
        lastStatus: 'running',
        lastError: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(automationRecipes.id, id))
      .run()
    this.notify('automation_flow_started', runId)
    try {
      let previousOutput: CapabilityValue = trigger?.data ?? trigger ?? null
      for (const [index, step] of current.steps.entries()) {
        if (
          !automationConditionsMatch(step.conditions || [], step.conditionMode || 'all', {
            trigger: (trigger || {}) as unknown as CapabilityValue,
            previous: previousOutput,
          })
        ) {
          this.audit(runId, current.id, 'step_skipped', step.capabilityId, {
            index,
            kind: step.kind,
          })
          continue
        }
        const input =
          step.inputSource === 'previous'
            ? previousOutput
            : step.inputSource === 'literal'
              ? (step.input ?? null)
              : (trigger?.data ?? trigger ?? null)
        const result = await this.executions.execute(step.kind, step.capabilityId, input, {
          workflowInstanceId: runId,
          idempotencyKey: trigger?.id ? `${trigger.id}:${id}:preflight:${index}` : null,
        })
        if (result.status !== 'succeeded') throw new Error(result.error || `${step.capabilityId} failed`)
        previousOutput = result.output
        if (
          step.kind === 'gate' &&
          result.output &&
          typeof result.output === 'object' &&
          !Array.isArray(result.output) &&
          result.output.passed === false
        ) {
          throw new Error(String(result.output.summary || `${step.capabilityId} did not pass`))
        }
      }
      if (current.threadAction !== 'none') {
        await this.startPromptFlow(runId, current, trigger)
      } else {
        await this.finishFlow(runId, current, trigger, null)
      }
    } catch (error) {
      this.failFlow(runId, error)
    }
    return this.get(id)!
  }

  startScheduleTimers() {
    this.#schedules.startTimers()
  }

  async handleJobTurnFinished(jobId: number, succeeded: boolean, error?: unknown) {
    const run = this.activeRun(jobId)
    if (!run) return
    if (!succeeded) {
      this.failQueuedPrompts(run.id, error || 'Agent prompt phase failed')
      this.failFlow(run.id, error || 'Agent prompt phase failed')
      return
    }
    const current = this.get(run.recipeId)
    if (!current) {
      this.failFlow(run.id, 'Automation recipe was removed while its flow was running')
      return
    }
    if (this.pauseForImprovementApproval(run, current, jobId)) return
    await this.completePromptPhase(run, current, jobId)
  }

  private pauseForImprovementApproval(run: AutomationFlowRun, current: AutomationRecipe, jobId: number) {
    if (current.threadAction !== 'improve') return false
    if (run.improvementApprovalStatus === 'pending') return true
    if (run.improvementApprovalStatus !== 'not-required') return false
    try {
      this.requestImprovementApproval(run.id, jobId)
    } catch (planError) {
      this.failFlow(run.id, planError)
    }
    return true
  }

  private async completePromptPhase(run: AutomationFlowRun, current: AutomationRecipe, jobId: number) {
    const progress = this.flowProgress(run.id)
    this.database
      .update(automationFlowRuns)
      .set({ currentPhase: progress.phase, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(automationFlowRuns.id, run.id))
      .run()
    if (progress.pending) {
      this.notify('automation_flow_phase_completed', run.id)
      return
    }
    try {
      await this.finishFlow(run.id, current, run.triggerEvent || undefined, this.threadSnapshot(jobId))
    } catch (actionError) {
      this.failFlow(run.id, actionError)
    }
  }

  async recoverRuns(staleBefore?: string) {
    const active = this.database
      .select()
      .from(automationFlowRuns)
      .where(
        and(
          eq(automationFlowRuns.status, 'running'),
          staleBefore ? sql`datetime(${automationFlowRuns.updatedAt}) <= datetime(${staleBefore})` : undefined,
        ),
      )
      .orderBy(asc(automationFlowRuns.id))
      .all()
    let recovered = 0
    let failed = 0
    for (const row of active) {
      const run = flowRunFromRow(row)
      if (run.improvementApprovalStatus === 'pending') continue
      if (!run.threadJobId) {
        const capability = this.database
          .select({ id: capabilityExecutions.id })
          .from(capabilityExecutions)
          .where(and(eq(capabilityExecutions.workflowInstanceId, run.id), inArray(capabilityExecutions.status, ['queued', 'running'])))
          .limit(1)
          .get()
        if (capability) continue
        this.failFlow(run.id, 'Automation flow was interrupted before its thread started')
        failed += 1
        continue
      }
      const job = this.database
        .select({ status: jobs.status, exitCode: jobs.exitCode })
        .from(jobs)
        .where(eq(jobs.id, run.threadJobId))
        .get()
      if (!job) {
        this.failFlow(run.id, 'Automation thread is no longer available')
        failed += 1
        continue
      }
      if (['completed', 'failed'].includes(job.status) && job.exitCode !== null) {
        await this.handleJobTurnFinished(run.threadJobId, job.status === 'completed' && job.exitCode === 0, 'Recovered agent phase failed')
        recovered += 1
      }
    }
    return { inspected: active.length, recovered, failed }
  }

  resolveImprovements(runId: number, selectedIds: unknown) {
    const run = this.getRun(runId)
    if (!run) throw new Error('Automation flow not found')
    if (run.improvementApprovalStatus !== 'pending') throw new Error('This improvement plan is no longer waiting for approval')
    const current = this.get(run.recipeId)
    if (!current || current.threadAction !== 'improve') throw new Error('This automation flow is not an Improve flow')
    if (!run.threadJobId) throw new Error('The Improve thread is no longer available')
    if (!Array.isArray(selectedIds)) throw new Error('Choose the improvement items to apply')
    const selected = [...new Set(selectedIds.map((value) => String(value)))].filter(Boolean)
    const available = new Map(run.improvementItems.map((item) => [item.id, item]))
    if (selected.some((id) => !available.has(id))) throw new Error('The improvement selection contains an unknown item')
    if (!selected.length) {
      this.database
        .update(automationFlowRuns)
        .set({
          status: 'cancelled',
          improvementApprovalStatus: 'declined',
          selectedImprovementIds: [],
          approvedAt: sql`CURRENT_TIMESTAMP`,
          finishedAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(automationFlowRuns.id, runId))
        .run()
      this.database
        .update(automationRecipes)
        .set({ lastStatus: 'cancelled', lastError: null, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(automationRecipes.id, current.id))
        .run()
      this.audit(runId, current.id, 'approval_declined', null, { selectedImprovementIds: [] })
      this.notify('automation_flow_approval_resolved', runId)
      return this.getRun(runId)!
    }
    const approvedItems = selected.map((id) => available.get(id)!)
    this.queuePrompt(run.threadJobId, this.improvementExecutionPrompt(current, approvedItems), {
      automationRunId: runId,
      automationPhase: 2,
    })
    this.database
      .update(automationFlowRuns)
      .set({
        improvementApprovalStatus: 'approved',
        selectedImprovementIds: selected,
        approvedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(automationFlowRuns.id, runId))
      .run()
    this.audit(runId, current.id, 'approval_granted', null, { selectedImprovementIds: selected })
    this.notify('automation_flow_approval_resolved', runId)
    return this.getRun(runId)!
  }

  async syncTriggers() {
    const triggerIds = new Set(
      this.list()
        .filter((item) => item.enabled && item.triggerId)
        .map((item) => item.triggerId!),
    )
    await replaceTriggerSubscriptions(this.#subscriptions, triggerIds, async (triggerId) => {
      let trigger: ReturnType<typeof this.registries.triggers.require>
      try {
        trigger = this.registries.triggers.require(triggerId)
      } catch {
        return null
      }
      const dispose = await trigger.subscribe((event) => {
        void this.runForTrigger(triggerId, event)
      })
      return typeof dispose === 'function' ? dispose : () => undefined
    })
  }

  private async runForTrigger(triggerId: string, event: TriggerEvent) {
    const matching = this.list().filter(
      (item) => item.enabled && item.triggerId === triggerId && automationConditionsMatch(item.conditions, item.conditionMode, event),
    )
    await Promise.allSettled(matching.map((item) => this.run(item.id, event)))
  }

  private createRun(current: AutomationRecipe, trigger?: TriggerEvent) {
    const idempotencyKey = automationEventIdempotencyKey(current.triggerId, trigger)
    const result = this.database
      .insert(automationFlowRuns)
      .values({
        recipeId: current.id,
        status: 'running',
        idempotencyKey,
        triggerEvent: trigger ? JSON.stringify(trigger) : null,
        currentPhase: 0,
        phaseCount: current.threadAction === 'improve' ? 2 : current.promptSteps.length,
      })
      .onConflictDoNothing()
      .run()
    if (result.changes) return { id: Number(result.lastInsertRowid), created: true }
    const existing = this.database
      .select({ id: automationFlowRuns.id })
      .from(automationFlowRuns)
      .where(and(eq(automationFlowRuns.recipeId, current.id), eq(automationFlowRuns.idempotencyKey, idempotencyKey)))
      .get()
    if (!existing) throw new Error('Automation flow could not resolve its idempotent run')
    return { id: Number(existing.id), created: false }
  }

  private phasePrompt(current: AutomationRecipe, phase: AutomationPromptStep, index: number, trigger?: TriggerEvent) {
    const eventContext = trigger ? `\n\nTrigger context:\n${JSON.stringify(trigger, null, 2)}` : ''
    const publicationBoundary = current.boundActions.length
      ? '\n\nExternal side effects configured as bound actions are owned by the automation runtime. Do not create, publish, merge, or deploy through the prompt; finish the repository work needed for this phase and let the runtime evaluate those actions.'
      : '\n\nThis flow has no bound publication action. Do not create, publish, merge, or deploy a pull request.'
    return `[Automation flow: ${current.name}]\n[Phase ${index + 1} of ${current.promptSteps.length}: ${phase.name}]\n\n${phase.prompt}${eventContext}${publicationBoundary}\n\nComplete this phase in the current thread. Preserve useful context and repository state for the next queued phase.`
  }

  private async startPromptFlow(runId: number, current: AutomationRecipe, trigger?: TriggerEvent) {
    const first = current.promptSteps[0]
    if (!first || current.threadAction === 'none') throw new Error('The automation flow has no initial prompt phase')
    const firstPrompt =
      current.threadAction === 'improve'
        ? this.improvementReviewPrompt(current, first, trigger)
        : this.phasePrompt(current, first, 0, trigger)
    const launched = await this.launchThread(current.threadAction, firstPrompt, trigger, recipeThreadLaunchOptions(current))
    if ('skippedReason' in launched) {
      this.skipPromptFlow(runId, current, launched.skippedReason)
      return
    }
    this.database
      .update(automationFlowRuns)
      .set({ threadJobId: launched.jobId, currentPhase: 1, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(automationFlowRuns.id, runId))
      .run()
    if (current.threadAction === 'improve') {
      this.notify('automation_flow_thread_started', runId)
      return
    }
    for (const [index, phase] of current.promptSteps.entries()) {
      if (index === 0) continue
      this.queuePrompt(launched.jobId, this.phasePrompt(current, phase, index, trigger), {
        automationRunId: runId,
        automationPhase: index + 1,
      })
    }
    this.notify('automation_flow_thread_started', runId)
  }

  private skipPromptFlow(runId: number, current: AutomationRecipe, reason: string) {
    this.audit(runId, current.id, 'thread_skipped', null, { reason })
    this.completeFlowState(runId, current)
  }

  private completeFlowState(runId: number, current: AutomationRecipe) {
    this.database
      .update(automationFlowRuns)
      .set({
        status: 'succeeded',
        currentPhase: sql`${automationFlowRuns.phaseCount}`,
        lastError: null,
        finishedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(automationFlowRuns.id, runId))
      .run()
    this.database
      .update(automationRecipes)
      .set({ lastStatus: 'succeeded', lastError: null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(automationRecipes.id, current.id))
      .run()
    this.notify('automation_flow_succeeded', runId)
  }

  private improvementReviewPrompt(current: AutomationRecipe, phase: AutomationPromptStep, trigger?: TriggerEvent) {
    const eventContext = trigger ? `\n\nTrigger context:\n${JSON.stringify(trigger, null, 2)}` : ''
    return `[Automation Improve flow: ${current.name}]
[Stage 1 of 2: Review and propose]

${phase.prompt}${eventContext}

Review the target and repository context deeply, but do not edit files, install dependencies, run mutating commands, commit, push, publish, merge, or deploy. Produce a concise improvement plan for human approval. Each item must be independently selectable and concrete enough to implement and verify.

End the response with this exact machine-readable marker containing valid JSON and no Markdown fences:
<!-- AUTOMATION_IMPROVEMENTS_JSON
[
  {
    "title": "Concise improvement",
    "description": "What to change, why, and how to verify it",
    "priority": "P2",
    "files": ["optional/likely/file.ts"]
  }
]
-->

Priority must be P0, P1, P2, or P3. Do not implement any item in this turn. The platform will pause this flow and present checkboxes; silence or merely starting this Improve flow is not approval.`
  }

  private improvementExecutionPrompt(current: AutomationRecipe, items: AutomationImprovementItem[]) {
    const publicationBoundary = current.boundActions.length
      ? 'External side effects are owned by the automation runtime. Do not create, publish, merge, or deploy through this prompt.'
      : 'This flow has no bound publication action. Do not create, publish, merge, or deploy a pull request.'
    return `[Automation Improve flow: ${current.name}]
[Stage 2 of 2: Apply approved improvements]

The user explicitly approved only the improvement items below:
${JSON.stringify(items, null, 2)}

Revalidate each approved item against the current repository state, implement it in this existing thread and worktree, and run proportionate validation. Do not implement unselected plan items. If an approved item is no longer applicable, explain why instead of forcing a change.

${publicationBoundary}

Finish with a concise per-item outcome and the exact validation performed.`
  }

  private requestImprovementApproval(runId: number, jobId: number) {
    const output = this.database.select({ resultText: jobs.resultText }).from(jobs).where(eq(jobs.id, jobId)).get()?.resultText
    const items = parseImprovementPlan(output)
    this.database
      .update(automationFlowRuns)
      .set({
        improvementItems: items,
        improvementApprovalStatus: 'pending',
        currentPhase: 1,
        approvalRequestedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(automationFlowRuns.id, runId))
      .run()
    const run = this.getRun(runId)
    if (run)
      this.audit(runId, run.recipeId, 'approval_requested', null, {
        improvementCount: items.length,
      })
    this.notify('automation_flow_approval_requested', runId)
  }

  private threadSnapshot(jobId: number) {
    const row = this.database
      .select({
        id: jobs.id,
        status: jobs.status,
        exitCode: jobs.exitCode,
        kind: jobs.kind,
        taskTitle: jobs.taskTitle,
        branchName: jobs.branchName,
        headSha: jobs.headSha,
        latestDiff: jobs.latestDiff,
        diffFiles: jobs.diffFiles,
        diffAdditions: jobs.diffAdditions,
        diffDeletions: jobs.diffDeletions,
        repoId: jobs.repoId,
        prNumber: jobs.prNumber,
        threadId: jobs.threadId,
        finishedAt: jobs.finishedAt,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .get()
    return row ? row : undefined
  }

  private activeRun(jobId: number) {
    const row = this.database
      .select()
      .from(automationFlowRuns)
      .where(and(eq(automationFlowRuns.threadJobId, jobId), eq(automationFlowRuns.status, 'running')))
      .orderBy(desc(automationFlowRuns.id))
      .limit(1)
      .get()
    return row ? flowRunFromRow(row) : null
  }

  private flowProgress(runId: number) {
    const pending = Boolean(
      this.database
        .select({ id: jobFollowUpQueue.id })
        .from(jobFollowUpQueue)
        .where(and(eq(jobFollowUpQueue.automationRunId, runId), inArray(jobFollowUpQueue.status, ['queued', 'running'])))
        .limit(1)
        .get(),
    )
    const completed = this.database
      .select({ phase: max(jobFollowUpQueue.automationPhase) })
      .from(jobFollowUpQueue)
      .where(and(eq(jobFollowUpQueue.automationRunId, runId), eq(jobFollowUpQueue.status, 'completed')))
      .get()
    return { pending, phase: Math.max(1, Number(completed?.phase || 0)) }
  }

  private async finishFlow(runId: number, current: AutomationRecipe, trigger?: TriggerEvent, thread?: Record<string, unknown> | null) {
    const conditionContext = { trigger: trigger || null, thread: thread || null }
    for (const [index, action] of current.boundActions.entries()) {
      await this.executeBoundAction(runId, current, action, index, conditionContext, trigger)
    }
    this.completeFlowState(runId, current)
  }

  private async executeBoundAction(
    runId: number,
    recipe: AutomationRecipe,
    action: AutomationBoundAction,
    index: number,
    conditionContext: Record<string, unknown>,
    trigger?: TriggerEvent,
  ) {
    if (!automationConditionsMatch(action.conditions, action.conditionMode, conditionContext)) return
    const input = action.input === undefined ? (trigger?.data ?? {}) : action.input
    const idempotencyKey = trigger?.id ? `${trigger.id}:${recipe.id}:bound:${index}` : `automation-run:${runId}:bound:${index}`
    this.audit(runId, recipe.id, 'external_action_started', action.capabilityId, {
      actionIndex: index,
    })
    const result = await this.executions.execute('action', action.capabilityId, input, {
      workflowInstanceId: runId,
      idempotencyKey,
    })
    this.audit(
      runId,
      recipe.id,
      result.status === 'succeeded' ? 'external_action_succeeded' : 'external_action_failed',
      action.capabilityId,
      {
        actionIndex: index,
        executionId: result.id,
        status: result.status,
        ...(result.error ? { error: result.error.slice(0, 1_000) } : {}),
      },
    )
    if (result.status !== 'succeeded') throw new Error(result.error || `${action.capabilityId} failed`)
  }

  private failQueuedPrompts(runId: number, error: unknown) {
    this.database
      .update(jobFollowUpQueue)
      .set({
        status: 'failed',
        lastError: String(error instanceof Error ? error.message : error).slice(0, 2_000),
        finishedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(jobFollowUpQueue.automationRunId, runId), eq(jobFollowUpQueue.status, 'queued')))
      .run()
  }

  private failFlow(runId: number, error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const run = this.getRun(runId)
    this.database
      .update(automationFlowRuns)
      .set({
        status: 'failed',
        lastError: message.slice(0, 4_000),
        finishedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(automationFlowRuns.id, runId))
      .run()
    if (run)
      this.database
        .update(automationRecipes)
        .set({ lastStatus: 'failed', lastError: message.slice(0, 4_000), updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(automationRecipes.id, run.recipeId))
        .run()
    if (run) this.audit(runId, run.recipeId, 'flow_failed', null, { error: message.slice(0, 1_000) })
    this.notify('automation_flow_failed', runId)
  }

  private audit(runId: number, recipeId: number, eventType: string, capabilityId: string | null, details: Record<string, unknown>) {
    this.database.insert(automationAuditEvents).values({ automationRunId: runId, recipeId, eventType, capabilityId, details }).run()
  }

  private requireStep(step: AutomationStep) {
    if (step.kind === 'action') return this.registries.actions.require(step.capabilityId)
    if (step.kind === 'query') return this.registries.queries.require(step.capabilityId)
    if (step.kind === 'transform') return this.registries.transforms.require(step.capabilityId)
    if (step.kind === 'gate') return this.registries.gates.require(step.capabilityId)
    if (step.kind === 'evidence') return this.registries.evidence.require(step.capabilityId)
    return this.registries.requireCustom(step.kind, step.capabilityId)
  }

  private requireCapabilities(value: NormalizedRecipeInput) {
    const trigger = value.triggerId ? this.registries.triggers.require(value.triggerId) : null
    if (value.threadAction !== 'none' && trigger && !supportsThreadTarget(value.threadAction, trigger)) {
      const label = value.threadAction === 'review' ? 'Review' : value.threadAction === 'improve' ? 'Improve' : 'Work'
      throw new Error(`The selected trigger does not provide a target for a ${label} thread`)
    }
    for (const step of value.steps) this.requireStep(step)
    for (const action of value.boundActions) this.registries.actions.require(action.capabilityId)
  }

  private update(id: number, value: NormalizedRecipeInput) {
    if (!this.get(id)) return null
    this.database
      .update(automationRecipes)
      .set({ ...this.recipeValues(value), updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(automationRecipes.id, id))
      .run()
    return id
  }

  private insert(value: NormalizedRecipeInput) {
    const result = this.database.insert(automationRecipes).values(this.recipeValues(value)).run()
    return Number(result.lastInsertRowid)
  }

  private recipeValues(value: NormalizedRecipeInput) {
    const storedAction = value.threadAction === 'improve' ? 'work' : value.threadAction
    const flowMode = value.threadAction === 'improve' ? 'improve' : 'direct'
    return {
      name: value.name,
      description: value.description,
      triggerId: value.triggerId,
      enabled: value.enabled ? 1 : 0,
      conditionMode: value.conditionMode,
      conditions: value.conditions,
      threadAction: storedAction,
      flowMode,
      agentId: value.agentId,
      model: value.model,
      reasoningEffort: value.reasoningEffort,
      serviceTier: value.serviceTier,
      allowSubagents: value.allowSubagents ? 1 : 0,
      resourceSelection: value.resourceSelection,
      promptSteps: value.promptSteps,
      boundActions: value.boundActions,
      steps: value.steps,
    }
  }
}

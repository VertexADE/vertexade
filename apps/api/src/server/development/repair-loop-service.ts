import { and, desc, eq, sql } from 'drizzle-orm'
import type {
  CapabilityValue,
  ImpactAnalysis,
  ValidationRepairLoop,
  ValidationRepairLoopState,
  ValidationRun,
} from '@vertexade/platform-contracts'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { validationRepairLoops } from '../database/schema/development-tables.ts'
import { jobs } from '../database/schema/tables.ts'
import type { CapabilityExecutionService } from '../workflows/capability-execution.ts'
import { impactAnalysisCapabilityId, validationCapabilityId } from './capabilities.ts'
import type { ImpactAnalysisService } from './impact-service.ts'
import type { ValidationIntelligenceService } from './validation-service.ts'

export type RepairLoopLauncher = (input: {
  run: ValidationRun
  title: string
  prompt: string
  linkedWorkItemId: number | null
}) => Promise<{ id: number; work_item_id?: number | null }>

type RepairLoopRow = typeof validationRepairLoops.$inferSelect
type RepairStopReason = ValidationRepairLoop['stopReason']

function positiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum) {
    throw new Error(`${label} must be a positive integer no greater than ${maximum}`)
  }
  return result
}

function outputRecord(value: CapabilityValue | null): Record<string, CapabilityValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, CapabilityValue>) : null
}

export class ValidationRepairLoopService {
  private reconciling = false

  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly impact: ImpactAnalysisService,
    private readonly validation: ValidationIntelligenceService,
    private readonly executions: CapabilityExecutionService,
    private readonly launchRepair: RepairLoopLauncher,
    private readonly notify: (reason: string, repositoryId: number) => void = () => undefined,
  ) {}

  getByRootRun(runId: number): ValidationRepairLoop | null {
    const row = this.database
      .select()
      .from(validationRepairLoops)
      .where(eq(validationRepairLoops.rootRunId, positiveInteger(runId, 'Validation run ID')))
      .get()
    return row ? this.record(row) : null
  }

  async start(runId: number, input: { maxAttempts?: unknown; maxElapsedMinutes?: unknown } = {}): Promise<ValidationRepairLoop> {
    const root = this.validation.getRun(positiveInteger(runId, 'Validation run ID'))
    if (!root) throw new Error('Validation run not found')
    const existing = this.getByRootRun(root.id)
    if (existing) return existing
    if (!['failed', 'timed-out'].includes(root.status)) throw new Error('Only failed or timed-out validation runs can start repair loops')
    if (root.repairJobId) throw new Error('This validation run already has a one-time repair Work')
    const maxAttempts = positiveInteger(input.maxAttempts || 3, 'Maximum repair attempts', 3)
    const maxElapsedMinutes = positiveInteger(input.maxElapsedMinutes || 120, 'Maximum elapsed minutes', 24 * 60)
    const deadlineAt = new Date(Date.now() + maxElapsedMinutes * 60_000).toISOString()
    const row = this.database
      .insert(validationRepairLoops)
      .values({
        rootRunId: root.id,
        currentRunId: root.id,
        currentJobId: null,
        state: 'active',
        maxAttempts,
        attemptCount: 0,
        deadlineAt,
      })
      .returning()
      .get()
    try {
      await this.launchNext(row, root)
    } catch (error) {
      this.stop(row.id, 'repair_failed')
      throw error
    }
    this.notify('validation_repair_loop_started', root.repositoryId)
    return this.require(row.id)
  }

  cancel(runId: number): ValidationRepairLoop {
    const loop = this.getByRootRun(runId)
    if (!loop) throw new Error('Validation repair loop not found')
    if (loop.state !== 'active') return loop
    this.database
      .update(validationRepairLoops)
      .set({ state: 'cancelled', finishedAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(validationRepairLoops.id, loop.id))
      .run()
    const root = this.validation.getRun(loop.rootRunId)
    if (root) this.notify('validation_repair_loop_cancelled', root.repositoryId)
    return this.require(loop.id)
  }

  async reconcile(): Promise<void> {
    if (this.reconciling) return
    this.reconciling = true
    try {
      const active = this.database
        .select()
        .from(validationRepairLoops)
        .where(eq(validationRepairLoops.state, 'active'))
        .orderBy(validationRepairLoops.id)
        .all()
      for (const row of active) await this.reconcileOne(row)
    } finally {
      this.reconciling = false
    }
  }

  startScheduler(intervalMs = 10_000): () => void {
    const interval = setInterval(() => void this.reconcile().catch(() => undefined), intervalMs)
    interval.unref?.()
    void this.reconcile().catch(() => undefined)
    return () => clearInterval(interval)
  }

  private async reconcileOne(row: RepairLoopRow): Promise<void> {
    if (Date.now() >= Date.parse(row.deadlineAt)) {
      this.stop(row.id, 'elapsed_limit')
      return
    }
    if (!row.currentJobId) {
      this.stop(row.id, 'repair_failed')
      return
    }
    const job = this.database.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, row.currentJobId)).get()
    if (!job || ['failed', 'cancelled'].includes(job.status)) {
      this.stop(row.id, 'repair_failed')
      return
    }
    if (job.status !== 'completed') return
    const current = this.validation.getRun(row.currentRunId)
    if (!current) {
      this.stop(row.id, 'repair_failed')
      return
    }
    try {
      const verification = await this.verify(row, current)
      if (!verification.stopReason) {
        this.stop(row.id, 'passed', 'completed')
        return
      }
      if (verification.stopReason === 'broader_impact' || verification.stopReason === 'repeated_fingerprint') {
        this.stop(row.id, verification.stopReason)
        return
      }
      const failed = [...verification.runs].reverse().find((run) => run.status === 'failed' || run.status === 'timed-out')
      if (!failed) {
        this.stop(row.id, 'repair_failed')
        return
      }
      if (row.attemptCount >= row.maxAttempts) {
        this.database
          .update(validationRepairLoops)
          .set({ currentRunId: failed.id, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(validationRepairLoops.id, row.id))
          .run()
        this.stop(row.id, 'attempt_limit')
        return
      }
      await this.launchNext(this.requireRow(row.id), failed)
    } catch {
      this.stop(row.id, 'repair_failed')
    }
  }

  private async verify(
    loop: RepairLoopRow,
    original: ValidationRun,
  ): Promise<{ runs: ValidationRun[]; stopReason: 'failed_target' | 'repeated_fingerprint' | 'broader_impact' | null }> {
    const workItemId = this.validation.repairWorkItemReady(original.id)
    const prepared = await this.impact.prepareWorkItem(workItemId)
    const analysis = await this.executeImpact(prepared)
    const current = await this.validation.intelligenceForImpact(analysis.id)
    const previous = await this.validation.intelligenceForImpact(original.impactAnalysisId)
    if (!current.catalog || !current.selection) throw new Error('Repair impact did not produce validation intelligence')
    const rerunTarget = current.catalog.targets.find((target) => target.id === original.target.id && target.enabled)
    if (!rerunTarget) throw new Error('The failed target is no longer in the trusted catalog')
    const previousIds = new Set(previous.selection?.selected.map((target) => target.id) || [])
    const broaderImpact = current.selection.selected.some((target) => !previousIds.has(target.id))
    const runs: ValidationRun[] = []
    const first = await this.executeValidation(loop, analysis.id, rerunTarget.id, original.id)
    runs.push(first)
    const repeated = first.failures.some((failure) => original.failures.some((candidate) => candidate.fingerprint === failure.fingerprint))
    if (first.status !== 'passed') return { runs, stopReason: repeated ? 'repeated_fingerprint' : 'failed_target' }
    if (broaderImpact) return { runs, stopReason: 'broader_impact' }
    for (const target of current.selection.selected.filter((target) => target.id !== rerunTarget.id)) {
      const run = await this.executeValidation(loop, analysis.id, target.id, original.id)
      runs.push(run)
      if (run.status !== 'passed') {
        const repeatedFailure = run.failures.some((failure) =>
          original.failures.some((candidate) => candidate.fingerprint === failure.fingerprint),
        )
        return { runs, stopReason: repeatedFailure ? 'repeated_fingerprint' : 'failed_target' }
      }
    }
    return { runs, stopReason: null }
  }

  private async executeImpact(input: Awaited<ReturnType<ImpactAnalysisService['prepareWorkItem']>>): Promise<ImpactAnalysis> {
    const execution = await this.executions.execute('query', impactAnalysisCapabilityId, input, {
      idempotencyKey: this.impact.idempotencyKey(input),
      context: { entityKind: 'work_item', entityKey: String(input.subject.kind === 'work_item' ? input.subject.workItemId : '') },
    })
    if (execution.status !== 'succeeded') throw new Error(execution.error || 'Repair-loop impact analysis failed')
    const analysisId = Number(outputRecord(execution.output)?.analysisId)
    if (!Number.isSafeInteger(analysisId) || analysisId <= 0) throw new Error('Repair-loop impact analysis returned an invalid result')
    return this.impact.attachExecution(analysisId, execution.id)
  }

  private async executeValidation(
    loop: RepairLoopRow,
    impactAnalysisId: number,
    targetId: string,
    parentRunId: number,
  ): Promise<ValidationRun> {
    const parent = this.validation.getRun(parentRunId)
    if (!parent) throw new Error('Repair-loop parent validation run not found')
    const execution = await this.executions.execute(
      'action',
      validationCapabilityId,
      { repositoryId: parent.repositoryId, impactAnalysisId, targetId, parentRunId },
      {
        idempotencyKey: `validation-repair-loop:${loop.id}:${loop.attemptCount}:${impactAnalysisId}:${targetId}`,
        context: { entityKind: 'repository', entityKey: String(parent.repositoryId) },
      },
    )
    if (execution.status !== 'succeeded') throw new Error(execution.error || 'Repair-loop validation failed to execute')
    const runId = Number(outputRecord(execution.output)?.runId)
    if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('Repair-loop validation returned an invalid result')
    return this.validation.attachExecution(runId, execution.id)
  }

  private async launchNext(loop: RepairLoopRow, run: ValidationRun): Promise<void> {
    const repair = this.validation.repairPrompt(run.id)
    const job = await this.launchRepair({
      ...repair,
      linkedWorkItemId: this.validation.linkedWorkItemId(run.id),
    })
    const attached = this.validation.attachRepair(run.id, job)
    this.database
      .update(validationRepairLoops)
      .set({
        currentRunId: run.id,
        currentJobId: attached.repairJobId,
        attemptCount: loop.attemptCount + 1,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(validationRepairLoops.id, loop.id), eq(validationRepairLoops.state, 'active')))
      .run()
  }

  private stop(id: number, reason: Exclude<RepairStopReason, null>, state: ValidationRepairLoopState = 'stopped'): void {
    this.database
      .update(validationRepairLoops)
      .set({ state, stopReason: reason, finishedAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(validationRepairLoops.id, id))
      .run()
    const loop = this.require(id)
    const root = this.validation.getRun(loop.rootRunId)
    if (root) this.notify(`validation_repair_loop_${state}`, root.repositoryId)
  }

  private require(id: number): ValidationRepairLoop {
    return this.record(this.requireRow(id))
  }

  private requireRow(id: number): RepairLoopRow {
    const row = this.database
      .select()
      .from(validationRepairLoops)
      .where(eq(validationRepairLoops.id, positiveInteger(id, 'Repair loop ID')))
      .orderBy(desc(validationRepairLoops.id))
      .get()
    if (!row) throw new Error('Validation repair loop not found')
    return row
  }

  private record(row: RepairLoopRow): ValidationRepairLoop {
    return {
      ...row,
      state: row.state as ValidationRepairLoopState,
      stopReason: row.stopReason as RepairStopReason,
    }
  }
}

import { and, asc, eq, exists, inArray, isNotNull, max, or, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from './database/dashboard-database.ts'
import { jobFollowUpQueue, jobs } from './database/schema/tables.ts'

type QueuedFollowUp = {
  id: number
  job_id: number
  prompt: string
  model: string | null
  reasoning_effort: string | null
  status: 'queued' | 'running' | 'completed' | 'failed'
  queued_at: string
  automation_run_id: number | null
  automation_phase: number | null
}

type QueueMetadata = {
  automationRunId?: number | null
  automationPhase?: number | null
}

export class JobFollowUpQueue {
  constructor(private readonly database: DrizzleDashboardDatabase) {}

  list(jobId: number) {
    return this.database
      .select({
        id: jobFollowUpQueue.id,
        prompt: jobFollowUpQueue.prompt,
        model: jobFollowUpQueue.model,
        reasoning_effort: jobFollowUpQueue.reasoningEffort,
        queued_at: jobFollowUpQueue.queuedAt,
      })
      .from(jobFollowUpQueue)
      .where(and(eq(jobFollowUpQueue.jobId, jobId), eq(jobFollowUpQueue.status, 'queued')))
      .orderBy(asc(jobFollowUpQueue.position), asc(jobFollowUpQueue.id))
      .all() as Array<Pick<QueuedFollowUp, 'id' | 'prompt' | 'model' | 'reasoning_effort' | 'queued_at'>>
  }

  queued(jobId: number, id: number) {
    const row = this.database
      .select()
      .from(jobFollowUpQueue)
      .where(and(eq(jobFollowUpQueue.id, id), eq(jobFollowUpQueue.jobId, jobId), eq(jobFollowUpQueue.status, 'queued')))
      .get()
    return row ? this.queuedFollowUp(row) : undefined
  }

  enqueue(jobId: number, prompt: string, model?: string | null, reasoningEffort?: string | null, metadata: QueueMetadata = {}) {
    const position =
      Number(
        this.database
          .select({ value: max(jobFollowUpQueue.position) })
          .from(jobFollowUpQueue)
          .where(eq(jobFollowUpQueue.jobId, jobId))
          .get()?.value || 0,
      ) + 1
    const result = this.database
      .insert(jobFollowUpQueue)
      .values({
        jobId,
        prompt,
        model: model || null,
        reasoningEffort: reasoningEffort || null,
        position,
        automationRunId: metadata.automationRunId || null,
        automationPhase: metadata.automationPhase || null,
      })
      .run()
    return {
      id: Number(result.lastInsertRowid),
      position,
      model: model || null,
      reasoning_effort: reasoningEffort || null,
    }
  }

  claim(jobId: number) {
    const row = this.database
      .select()
      .from(jobFollowUpQueue)
      .where(and(eq(jobFollowUpQueue.jobId, jobId), eq(jobFollowUpQueue.status, 'queued')))
      .orderBy(asc(jobFollowUpQueue.position), asc(jobFollowUpQueue.id))
      .limit(1)
      .get()
    if (!row) return null
    const claimed = this.database
      .update(jobFollowUpQueue)
      .set({
        status: 'running',
        startedAt: sql`CURRENT_TIMESTAMP`,
        lastError: null,
      })
      .where(and(eq(jobFollowUpQueue.id, row.id), eq(jobFollowUpQueue.status, 'queued')))
      .run()
    return claimed.changes ? { ...this.queuedFollowUp(row), status: 'running' as const } : null
  }

  updateQueuedContext(jobId: number, model?: string | null, reasoningEffort?: string | null) {
    if (!model && !reasoningEffort) return 0
    return this.database
      .update(jobFollowUpQueue)
      .set({
        model: model || sql`${jobFollowUpQueue.model}`,
        reasoningEffort: reasoningEffort || sql`${jobFollowUpQueue.reasoningEffort}`,
      })
      .where(and(eq(jobFollowUpQueue.jobId, jobId), eq(jobFollowUpQueue.status, 'queued')))
      .run().changes
  }

  finishRunning(jobId: number, succeeded: boolean, error?: string | null) {
    const item = this.database
      .select({ id: jobFollowUpQueue.id })
      .from(jobFollowUpQueue)
      .where(and(eq(jobFollowUpQueue.jobId, jobId), eq(jobFollowUpQueue.status, 'running')))
      .orderBy(asc(jobFollowUpQueue.startedAt), asc(jobFollowUpQueue.id))
      .limit(1)
      .get()
    if (!item) return false
    this.database
      .update(jobFollowUpQueue)
      .set({
        status: succeeded ? 'completed' : 'failed',
        lastError: succeeded ? null : String(error || 'Agent turn failed').slice(0, 2000),
        finishedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(jobFollowUpQueue.id, item.id))
      .run()
    return true
  }

  fail(id: number, error: unknown) {
    this.database
      .update(jobFollowUpQueue)
      .set({
        status: 'failed',
        lastError: String(error instanceof Error ? error.message : error).slice(0, 2000),
        finishedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(jobFollowUpQueue.id, id))
      .run()
  }

  completeQueued(jobId: number, id: number) {
    return (
      this.database
        .update(jobFollowUpQueue)
        .set({ status: 'completed', finishedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(jobFollowUpQueue.id, id), eq(jobFollowUpQueue.jobId, jobId), eq(jobFollowUpQueue.status, 'queued')))
        .run().changes === 1
    )
  }

  removeQueued(jobId: number, id: number) {
    return (
      this.database
        .delete(jobFollowUpQueue)
        .where(and(eq(jobFollowUpQueue.id, id), eq(jobFollowUpQueue.jobId, jobId), eq(jobFollowUpQueue.status, 'queued')))
        .run().changes === 1
    )
  }

  reorder(jobId: number, orderedIds: number[]) {
    const currentIds = this.list(jobId).map((item) => item.id)
    if (currentIds.length !== orderedIds.length || orderedIds.some((id) => !currentIds.includes(id))) return false
    this.database.transaction((transaction) => {
      orderedIds.forEach((id, index) =>
        transaction
          .update(jobFollowUpQueue)
          .set({ position: index + 1 })
          .where(and(eq(jobFollowUpQueue.id, id), eq(jobFollowUpQueue.jobId, jobId), eq(jobFollowUpQueue.status, 'queued')))
          .run(),
      )
    })
    return true
  }

  hasPending(jobId: number) {
    return Boolean(
      this.database
        .select({ id: jobFollowUpQueue.id })
        .from(jobFollowUpQueue)
        .where(and(eq(jobFollowUpQueue.jobId, jobId), inArray(jobFollowUpQueue.status, ['queued', 'running'])))
        .limit(1)
        .get(),
    )
  }

  recoverFinishedJobs() {
    return this.database
      .update(jobFollowUpQueue)
      .set({
        status: 'completed',
        finishedAt: sql`COALESCE(${jobFollowUpQueue.finishedAt}, CURRENT_TIMESTAMP)`,
      })
      .where(
        and(
          eq(jobFollowUpQueue.status, 'running'),
          exists(
            this.database
              .select({ id: jobs.id })
              .from(jobs)
              .where(
                and(
                  eq(jobs.id, jobFollowUpQueue.jobId),
                  or(eq(jobs.status, 'completed'), and(eq(jobs.status, 'failed'), isNotNull(jobs.exitCode))),
                ),
              ),
          ),
        ),
      )
      .run().changes
  }

  queuedJobIds() {
    return this.database
      .selectDistinct({ jobId: jobFollowUpQueue.jobId })
      .from(jobFollowUpQueue)
      .where(eq(jobFollowUpQueue.status, 'queued'))
      .all()
      .map((row) => row.jobId)
  }

  private queuedFollowUp(row: typeof jobFollowUpQueue.$inferSelect): QueuedFollowUp {
    return {
      id: row.id,
      job_id: row.jobId,
      prompt: row.prompt,
      model: row.model,
      reasoning_effort: row.reasoningEffort,
      status: row.status as QueuedFollowUp['status'],
      queued_at: row.queuedAt,
      automation_run_id: row.automationRunId,
      automation_phase: row.automationPhase,
    }
  }
}

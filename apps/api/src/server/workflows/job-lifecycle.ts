import { and, eq, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs } from '../database/schema/tables.ts'

const jobStatuses = ['starting', 'running', 'resumable', 'completed', 'failed', 'cancelled'] as const

export type JobStatus = (typeof jobStatuses)[number]

export class InvalidJobTransitionError extends Error {
  constructor(jobId: number, from: JobStatus, to: JobStatus) {
    super(`Job #${jobId} cannot transition from ${from} to ${to}`)
    this.name = 'InvalidJobTransitionError'
  }
}

const transitions: Record<JobStatus, readonly JobStatus[]> = {
  starting: ['running', 'resumable', 'completed', 'failed', 'cancelled'],
  running: ['starting', 'running', 'resumable', 'completed', 'failed', 'cancelled'],
  resumable: ['starting', 'running', 'resumable', 'completed', 'failed'],
  completed: ['starting', 'running', 'completed'],
  failed: ['starting', 'running', 'resumable', 'completed', 'failed'],
  cancelled: ['starting', 'running', 'cancelled'],
}

function isJobStatus(value: unknown): value is JobStatus {
  return jobStatuses.includes(value as JobStatus)
}

export class JobLifecycle {
  constructor(private readonly database: DrizzleDashboardDatabase) {}

  status(jobId: number): JobStatus {
    const status = this.database.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).get()?.status
    if (!isJobStatus(status)) throw new Error(`Job #${jobId} has an unknown status: ${String(status)}`)
    return status
  }

  markStarting(jobId: number, activity: string, options: { clearResult?: boolean } = {}) {
    this.assertTransition(jobId, 'starting')
    this.database
      .update(jobs)
      .set({
        status: 'starting',
        exitCode: null,
        finishedAt: null,
        resultText: options.clearResult ? null : sql`${jobs.resultText}`,
        latestActivity: activity,
        activityAt: sql`CURRENT_TIMESTAMP`,
        inputRequestId: null,
        inputQuestions: null,
        inputRequestedAt: null,
      })
      .where(eq(jobs.id, jobId))
      .run()
  }

  claimStarting(jobId: number, activity: string) {
    const current = this.status(jobId)
    if (!transitions[current].includes('starting')) throw new InvalidJobTransitionError(jobId, current, 'starting')
    const result = this.database
      .update(jobs)
      .set({ status: 'starting', exitCode: null, finishedAt: null, latestActivity: activity, activityAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, current)))
      .run()
    return Number(result.changes) > 0
  }

  restore(jobId: number, previous: { status: JobStatus; activity?: string | null; finishedAt?: string | null }) {
    if (this.status(jobId) !== 'starting') throw new Error(`Job #${jobId} can only be restored while starting`)
    this.database
      .update(jobs)
      .set({ status: previous.status, latestActivity: previous.activity ?? null, finishedAt: previous.finishedAt ?? null })
      .where(eq(jobs.id, jobId))
      .run()
  }

  markRunning(jobId: number, options: { pid?: number | null; agentId?: string | null; activity?: string | null } = {}) {
    this.assertTransition(jobId, 'running')
    this.database
      .update(jobs)
      .set({
        status: 'running',
        pid: options.pid ?? sql`${jobs.pid}`,
        agentId: options.agentId ?? sql`${jobs.agentId}`,
        pidStartIdentity: options.pid === undefined ? sql`${jobs.pidStartIdentity}` : null,
        exitCode: null,
        latestActivity: options.activity ?? sql`${jobs.latestActivity}`,
        activityAt: sql`CURRENT_TIMESTAMP`,
        finishedAt: null,
      })
      .where(eq(jobs.id, jobId))
      .run()
  }

  markResumable(jobId: number, activity: string) {
    this.assertTransition(jobId, 'resumable')
    this.database
      .update(jobs)
      .set({
        status: 'resumable',
        latestActivity: activity,
        activityAt: sql`CURRENT_TIMESTAMP`,
        finishedAt: sql`CURRENT_TIMESTAMP`,
        inputRequestId: null,
        inputQuestions: null,
        inputRequestedAt: null,
      })
      .where(eq(jobs.id, jobId))
      .run()
  }

  markFailed(jobId: number, message: string, exitCode = 1) {
    this.assertTransition(jobId, 'failed')
    this.database
      .update(jobs)
      .set({
        status: 'failed',
        exitCode,
        latestActivity: message,
        activityAt: sql`CURRENT_TIMESTAMP`,
        finishedAt: sql`CURRENT_TIMESTAMP`,
        inputRequestId: null,
        inputQuestions: null,
        inputRequestedAt: null,
      })
      .where(eq(jobs.id, jobId))
      .run()
  }

  markCancelled(jobId: number, reason = 'Stopped by user') {
    this.assertTransition(jobId, 'cancelled')
    this.database
      .update(jobs)
      .set({
        status: 'cancelled',
        exitCode: null,
        latestActivity: reason,
        activityAt: sql`CURRENT_TIMESTAMP`,
        finishedAt: sql`CURRENT_TIMESTAMP`,
        inputRequestId: null,
        inputQuestions: null,
        inputRequestedAt: null,
      })
      .where(eq(jobs.id, jobId))
      .run()
  }

  markFinished(jobId: number, exitCode: number, failure: string) {
    const status: JobStatus = exitCode === 0 ? 'completed' : 'failed'
    this.assertTransition(jobId, status)
    this.database
      .update(jobs)
      .set({
        status,
        exitCode,
        latestActivity: exitCode === 0 ? sql`${jobs.latestActivity}` : failure,
        activityAt: sql`CURRENT_TIMESTAMP`,
        finishedAt: sql`CURRENT_TIMESTAMP`,
        inputRequestId: null,
        inputQuestions: null,
        inputRequestedAt: null,
      })
      .where(eq(jobs.id, jobId))
      .run()
  }

  markReconciledCompleted(jobId: number, activity: string, finishedAt: string) {
    this.assertTransition(jobId, 'completed')
    this.database
      .update(jobs)
      .set({
        status: 'completed',
        exitCode: 0,
        latestActivity: activity || sql`${jobs.latestActivity}`,
        activityAt: finishedAt,
        finishedAt,
        inputRequestId: null,
        inputQuestions: null,
        inputRequestedAt: null,
      })
      .where(eq(jobs.id, jobId))
      .run()
  }

  private assertTransition(jobId: number, next: JobStatus) {
    const current = this.status(jobId)
    if (!transitions[current].includes(next)) throw new InvalidJobTransitionError(jobId, current, next)
  }
}

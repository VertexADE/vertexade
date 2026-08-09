import { readFile } from 'node:fs/promises'
import { and, asc, count, eq, inArray, lte, min, ne, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from './database/dashboard-database.ts'
import { automaticReviewQueue, automationFlowRuns, automationRuntimeControl, jobFollowUpQueue, jobs } from './database/schema/tables.ts'

async function deploymentRecord(path: string) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function operationalHealth(
  database: DrizzleDashboardDatabase,
  deploymentPath: string,
  runtime = {
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    residentMemoryBytes: process.memoryUsage().rss,
  },
) {
  const oldestQueuedReview =
    database
      .select({ queuedAt: automaticReviewQueue.queuedAt })
      .from(automaticReviewQueue)
      .orderBy(asc(automaticReviewQueue.queuedAt), asc(automaticReviewQueue.id))
      .limit(1)
      .get()?.queuedAt || null
  const scalarCount = (query: { get(): { count: number } | undefined }) => Number(query.get()?.count || 0)
  return {
    deployment: await deploymentRecord(deploymentPath),
    process: runtime,
    queues: {
      queuedFollowUps: scalarCount(database.select({ count: count() }).from(jobFollowUpQueue).where(eq(jobFollowUpQueue.status, 'queued'))),
      queuedReviews: scalarCount(database.select({ count: count() }).from(automaticReviewQueue)),
      oldestQueuedReview,
    },
    activity: {
      activeJobs: scalarCount(
        database
          .select({ count: count() })
          .from(jobs)
          .where(inArray(jobs.status, ['starting', 'running'])),
      ),
      failedAutomations: scalarCount(
        database.select({ count: count() }).from(automationFlowRuns).where(eq(automationFlowRuns.status, 'failed')),
      ),
    },
    automations: {
      paused: Boolean(
        database
          .select({ paused: automationRuntimeControl.paused })
          .from(automationRuntimeControl)
          .where(eq(automationRuntimeControl.id, 1))
          .get()?.paused,
      ),
      activeRuns: scalarCount(database.select({ count: count() }).from(automationFlowRuns).where(eq(automationFlowRuns.status, 'running'))),
      pendingApprovals: scalarCount(
        database
          .select({ count: count() })
          .from(automationFlowRuns)
          .where(and(eq(automationFlowRuns.status, 'running'), eq(automationFlowRuns.improvementApprovalStatus, 'pending'))),
      ),
      staleRuns: scalarCount(
        database
          .select({ count: count() })
          .from(automationFlowRuns)
          .where(
            and(
              eq(automationFlowRuns.status, 'running'),
              ne(automationFlowRuns.improvementApprovalStatus, 'pending'),
              lte(automationFlowRuns.updatedAt, sql`datetime('now', '-1 hour')`),
            ),
          ),
      ),
      oldestActiveAt:
        database
          .select({ value: min(automationFlowRuns.updatedAt) })
          .from(automationFlowRuns)
          .where(eq(automationFlowRuns.status, 'running'))
          .get()?.value ?? null,
    },
  }
}

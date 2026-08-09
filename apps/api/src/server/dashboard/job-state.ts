import { eq, isNull, sql } from 'drizzle-orm'
import type { Agent } from '@vertexade/platform-contracts'
import type { AgentRegistry } from '../agents/registry.ts'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs } from '../database/schema/tables.ts'
import { readFileTail } from '../log-files.ts'
import { parseAgentLogEvents } from '../agent-timeline.ts'
import { summarizeDiff } from '../diff-preview.ts'

export function createJobDiffStore(database: DrizzleDashboardDatabase, notify: (reason: string, jobId: number) => void) {
  return (jobId: number, diff: string) => {
    const summary = summarizeDiff(diff)
    database
      .update(jobs)
      .set({
        latestDiff: diff,
        diffFiles: JSON.stringify(summary.files),
        diffAdditions: summary.additions,
        diffDeletions: summary.deletions,
      })
      .where(eq(jobs.id, jobId))
      .run()
    notify('diff', jobId)
    return summary
  }
}

export async function backfillJobActivity(database: DrizzleDashboardDatabase, agents: AgentRegistry, fallbackAgent: Readonly<Agent>) {
  const pending = database
    .select({ id: jobs.id, logPath: jobs.logPath, agentId: jobs.agentId })
    .from(jobs)
    .where(isNull(jobs.latestActivity))
    .all()
  for (const job of pending) {
    try {
      const events = parseAgentLogEvents(await readFileTail(job.logPath, 250_000), agents.get(job.agentId) || fallbackAgent)
      const latest = events.filter((event) => event.kind === 'message').at(-1)
      if (latest)
        database
          .update(jobs)
          .set({ latestActivity: latest.text, activityAt: sql`coalesce(${latest.time}, ${jobs.finishedAt}, ${jobs.createdAt})` })
          .where(eq(jobs.id, job.id))
          .run()
    } catch {}
  }
}

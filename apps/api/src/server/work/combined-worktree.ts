import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs } from '../database/schema/tables.ts'

export type CombinedWorktreeAllocation = {
  worktree: string
  created: boolean
  branchName: string | null
  headSha: string | null
}

export function reusedCombinedWorktree(
  db: DrizzleDashboardDatabase,
  allocation: CombinedWorktreeAllocation,
  input: {
    workItemId: number
    repositoryId: number
    repositoryName: string
    fallbackHeadSha: string
  },
) {
  const active = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.worktreePath, allocation.worktree), inArray(jobs.status, ['starting', 'running'])))
    .orderBy(desc(jobs.id))
    .limit(1)
    .get()
  if (active?.id) {
    throw new Error(`${input.repositoryName} already has an active thread #${active.id} in its combined worktree`)
  }
  const firstRun = db
    .select({ headSha: jobs.headSha })
    .from(jobs)
    .where(and(eq(jobs.workItemId, input.workItemId), eq(jobs.repoId, input.repositoryId), eq(jobs.worktreePath, allocation.worktree)))
    .orderBy(asc(jobs.id))
    .limit(1)
    .get()
  return {
    branchName: allocation.branchName,
    headSha: firstRun?.headSha || allocation.headSha || input.fallbackHeadSha,
  }
}

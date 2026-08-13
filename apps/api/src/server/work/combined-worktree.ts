import { dirname } from 'node:path'
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs } from '../database/schema/tables.ts'

export type CombinedWorktreeAllocation = {
  worktree: string
  created: boolean
  branchName: string | null
  headSha: string | null
}

export function assertCombinedWorktreeIdle(db: DrizzleDashboardDatabase, worktree: string, repositoryName: string): void {
  const active = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(or(eq(jobs.worktreePath, worktree), eq(jobs.sessionCwd, dirname(worktree))), inArray(jobs.status, ['starting', 'running'])))
    .orderBy(desc(jobs.id))
    .limit(1)
    .get()
  if (active?.id) throw new Error(`${repositoryName} already has an active thread #${active.id} in its combined worktree`)
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
  assertCombinedWorktreeIdle(db, allocation.worktree, input.repositoryName)
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

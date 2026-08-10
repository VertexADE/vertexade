import { rmdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { MergedWorktreeCleanupResult } from '@vertexade/platform-contracts'
import { vertexWorkItemDirectory } from '@vertexade/platform-server/configuration'
import { asc, eq, isNotNull, isNull, max, min, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, repositories } from '../database/schema/tables.ts'
import { withWorktreeOwnershipRepair } from './worktree-ownership.ts'
import { pathExists as defaultPathExists } from './worktree-filesystem.ts'
import { isManagedJobWorkspacePath } from './workspace-layout.ts'

type RuntimeAgent = {
  name: string
  workspaceRoot: string
}

type Dependencies = {
  db: DrizzleDashboardDatabase
  agents: { require(id: string): RuntimeAgent }
  defaultAgentId: string
  run(command: string, args: string[]): Promise<string>
  workItemWorkspaceRoot?: string
  beforeRemoveJobs?: (jobs: any[]) => Promise<void>
  notify?: (reason: string, id?: number) => void
  pathExists?: (path: string) => Promise<boolean>
}

function missingWorktree(error: unknown) {
  return /is not a working tree|not a working tree|not registered as a worktree/i.test(
    error instanceof Error ? error.message : String(error),
  )
}

export function createMergedWorktreeCleanup(dependencies: Dependencies) {
  const pathExists = dependencies.pathExists || defaultPathExists
  const workItemWorkspaceRoot = dependencies.workItemWorkspaceRoot || vertexWorkItemDirectory()

  function candidates(repositoryId?: number) {
    const conditions = [isNotNull(jobs.prMergedAt), isNull(jobs.worktreeRemovedAt), isNotNull(jobs.worktreePath)]
    if (repositoryId) conditions.push(eq(jobs.repoId, repositoryId))
    return dependencies.db
      .select({ id: min(jobs.id), worktree_path: jobs.worktreePath, merged_at: max(jobs.prMergedAt) })
      .from(jobs)
      .where(sql.join(conditions, sql` AND `))
      .groupBy(jobs.worktreePath)
      .orderBy(asc(max(jobs.prMergedAt)))
      .all()
  }

  function relatedJobs(worktreePath: string) {
    return dependencies.db
      .select({
        id: jobs.id,
        status: jobs.status,
        linked_pr_number: jobs.linkedPrNumber,
        pr_number: jobs.prNumber,
        pr_closed_at: jobs.prClosedAt,
        pr_merged_at: jobs.prMergedAt,
        agent_id: jobs.agentId,
        worktree_path: jobs.worktreePath,
        base_repo_path: jobs.baseRepoPath,
        workspace_mode: jobs.workspaceMode,
        session_cwd: jobs.sessionCwd,
        thread_id: jobs.threadId,
        repository_path: repositories.localPath,
      })
      .from(jobs)
      .innerJoin(repositories, eq(repositories.id, jobs.repoId))
      .where(eq(jobs.worktreePath, worktreePath))
      .orderBy(asc(jobs.id))
      .all()
  }

  function removalContext(related: any[]) {
    const active = related.find((job) => ['starting', 'running'].includes(job.status))
    if (active) throw new Error(`Thread #${active.id} is still active in this worktree`)
    const openPullRequest = related.find(
      (job) => Number(job.linked_pr_number || job.pr_number) > 0 && !job.pr_closed_at && !job.pr_merged_at,
    )
    if (openPullRequest) {
      throw new Error(`Pull request #${openPullRequest.linked_pr_number || openPullRequest.pr_number} is still open in this worktree`)
    }
    const job = related.find((entry) => entry.pr_merged_at) || related[0]
    const runtimeAgent = dependencies.agents.require(job.agent_id || dependencies.defaultAgentId)
    const worktree = resolve(job.worktree_path)
    if (!isManagedJobWorkspacePath(job, worktree, runtimeAgent.workspaceRoot, workItemWorkspaceRoot)) {
      throw new Error(`Refusing to remove a worktree outside VertexADE-managed workspace storage for ${runtimeAgent.name}`)
    }
    if (resolve(job.base_repo_path) !== resolve(job.repository_path)) {
      throw new Error('Refusing to remove a worktree with an unexpected base repository path')
    }
    return { job, runtimeAgent, worktree }
  }

  async function removeGitWorktree(job: any, worktree: string) {
    if (!(await pathExists(worktree))) return
    try {
      await withWorktreeOwnershipRepair(dependencies.run, worktree, () =>
        dependencies.run('git', ['-C', job.base_repo_path, 'worktree', 'remove', '--force', worktree]),
      )
    } catch (error) {
      if ((await pathExists(worktree)) || !missingWorktree(error)) throw error
    }
    try {
      await dependencies.run('git', ['-C', job.base_repo_path, 'worktree', 'prune'])
    } catch {}
  }

  async function removeCombinedRoot(job: any, runtimeAgent: RuntimeAgent) {
    if (job.workspace_mode !== 'combined' || !job.session_cwd) return
    if (!isManagedJobWorkspacePath(job, job.session_cwd, runtimeAgent.workspaceRoot, workItemWorkspaceRoot)) return
    try {
      await rmdir(resolve(job.session_cwd))
    } catch {}
  }

  async function removeCandidate(candidate: any) {
    const related = relatedJobs(candidate.worktree_path)
    if (!related.length) return false
    const { job, runtimeAgent, worktree } = removalContext(related)
    if (dependencies.beforeRemoveJobs) await dependencies.beforeRemoveJobs(related)
    await removeGitWorktree(job, worktree)
    dependencies.db
      .update(jobs)
      .set({ worktreeRemovedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(jobs.worktreePath, job.worktree_path))
      .run()
    await removeCombinedRoot(job, runtimeAgent)
    dependencies.notify?.('merged_pr_worktree_removed', job.id)
    return true
  }

  async function removeMerged(repositoryId?: number): Promise<MergedWorktreeCleanupResult> {
    const result: MergedWorktreeCleanupResult = { removed: 0, paths: [], errors: [] }
    for (const candidate of candidates(repositoryId)) {
      try {
        if (!(await removeCandidate(candidate))) continue
        result.removed += 1
        result.paths.push(candidate.worktree_path)
      } catch (error) {
        result.errors.push({
          target: candidate.worktree_path,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return result
  }

  return { removeMerged }
}

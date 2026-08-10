import { createHash } from 'node:crypto'
import { createReadStream, constants as fsConstants } from 'node:fs'
import { copyFile, lstat, mkdir, realpath, rm, unlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { and, asc, eq, ne, or, sql } from 'drizzle-orm'
import type { WorkService } from './service.ts'
import type { WorkMemoryService } from './memory.ts'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs as jobsTable, repositories } from '../database/schema/tables.ts'
import type { WorkDeletionError, WorkDeletionPreview, WorkDeletionResult } from '@vertexade/platform-contracts'
import { vertexWorkItemDirectory } from '@vertexade/platform-server/configuration'
import { withWorktreeOwnershipRepair } from './worktree-ownership.ts'
import { createMergedWorktreeCleanup } from './merged-worktree-cleanup.ts'
import { isPathInside, pathExists as defaultPathExists } from './worktree-filesystem.ts'
import { removeProviderThread as removeAgentProviderThread } from './provider-thread-cleanup.ts'
import { CleanupTombstoneStore, type CleanupArtifactInput } from './cleanup-tombstones.ts'
import { isManagedJobWorkspacePath } from './workspace-layout.ts'

type RuntimeAgent = {
  name: string
  workspaceRoot: string
  deleteThread?(threadId: string): Promise<void>
}

type Dependencies = {
  db: DrizzleDashboardDatabase
  work: WorkService
  memory?: Pick<WorkMemoryService, 'exists' | 'remove'>
  agents: { require(id: string): RuntimeAgent }
  defaultAgentId: string
  activeJobs: Map<number, any>
  logsRoot: string
  workItemWorkspaceRoot?: string
  legacyLogsRoots?: string[]
  run(command: string, args: string[]): Promise<string>
  stopProcess?: (job: any, child: any) => Promise<void>
  removeFile?: (path: string) => Promise<void>
  invalidateLog?: (path: string) => void
  removeDirectory?: (path: string) => Promise<void>
  pathExists?: (path: string) => Promise<boolean>
  beforeRemoveJobs?: (jobs: any[]) => Promise<void>
  notify?: (reason: string, id?: number) => void
  makeDirectory?: (path: string) => Promise<void>
  removeEmptyDirectory?: (path: string) => Promise<void>
}

type CleanupState = {
  errors: WorkDeletionError[]
  blockedJobs: Set<number>
  worktreesRemoved: number
  branchesDeleted: number
  logsDeleted: number
  logsRetained: number
  providerThreadsRetained: number
  threadsDeleted: number
}

class BlockedCleanupError extends Error {}

export function legacyLogRoots(value: string | undefined) {
  return String(value || '')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean)
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function stopChildProcess(_job: any, child: any) {
  if (!child || child.exitCode !== null || child.signalCode) return
  await new Promise<void>((resolveStop, rejectStop) => {
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const timeout = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
        killTimer = setTimeout(() => rejectStop(new Error('Agent process did not stop after SIGKILL')), 2_000)
      } catch (error) {
        rejectStop(error instanceof Error ? error : new Error(String(error)))
      }
    }, 3_000)
    const done = () => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      resolveStop()
    }
    child.once('close', done)
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM')
      else child.kill('SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch (error) {
        rejectStop(error instanceof Error ? error : new Error(String(error)))
      }
    }
  })
}

function missingWorktreeRegistration(error: unknown) {
  return /is not a working tree|not a working tree|not registered as a worktree/i.test(message(error))
}

function assertSafeWorktree(job: any, runtimeAgent: RuntimeAgent, workItemWorkspaceRoot: string) {
  if (!isManagedJobWorkspacePath(job, job.worktree_path, runtimeAgent.workspaceRoot, workItemWorkspaceRoot)) {
    throw new Error(`Refusing to remove a worktree outside VertexADE-managed workspace storage for ${runtimeAgent.name}`)
  }
  if (resolve(job.base_repo_path) !== resolve(job.repository_path)) throw new Error('Refusing to use an unexpected base repository path')
}

export function createWorkCleanup(dependencies: Dependencies) {
  const removeFile = dependencies.removeFile || unlink
  const removeDirectory = dependencies.removeDirectory || ((path: string) => rm(path, { recursive: true, force: true }))
  const pathExists = dependencies.pathExists || defaultPathExists
  const stopProcess = dependencies.stopProcess || stopChildProcess
  const tombstones = new CleanupTombstoneStore(dependencies.db)
  const workItemWorkspaceRoot = dependencies.workItemWorkspaceRoot || vertexWorkItemDirectory()
  const legacyLogsRoots = (dependencies.legacyLogsRoots || []).map((path) => resolve(path))
  let recoveryTimer: ReturnType<typeof setInterval> | undefined

  function artifactFinished(tombstoneId: number, identity: string) {
    return ['complete', 'detached'].includes(tombstones.artifact(tombstoneId, identity)?.state || '')
  }

  function jobs(workItemId: number) {
    return dependencies.db
      .select({
        id: jobsTable.id,
        agent_id: jobsTable.agentId,
        base_repo_path: jobsTable.baseRepoPath,
        branch_name: jobsTable.branchName,
        ephemeral: jobsTable.ephemeral,
        log_path: jobsTable.logPath,
        session_cwd: jobsTable.sessionCwd,
        status: jobsTable.status,
        thread_id: jobsTable.threadId,
        workspace_mode: jobsTable.workspaceMode,
        worktree_path: jobsTable.worktreePath,
        full_name: repositories.fullName,
        repository_path: repositories.localPath,
      })
      .from(jobsTable)
      .innerJoin(repositories, eq(repositories.id, jobsTable.repoId))
      .where(eq(jobsTable.workItemId, workItemId))
      .orderBy(asc(jobsTable.id))
      .all() as any[]
  }

  function sharedWorktreeCount(workItemId: number, path: string) {
    return countOtherJobs(workItemId, eq(jobsTable.worktreePath, path))
  }

  function sharedBranchCount(workItemId: number, baseRepoPath: string, branch: string) {
    return countOtherJobs(workItemId, and(eq(jobsTable.baseRepoPath, baseRepoPath), eq(jobsTable.branchName, branch)))
  }

  function sharedWorkspaceCount(workItemId: number, path: string) {
    return countOtherJobs(workItemId, eq(jobsTable.sessionCwd, path))
  }

  function countOtherJobs(workItemId: number, condition: ReturnType<typeof eq>) {
    return Number(
      dependencies.db
        .select({ count: sql<number>`count(*)` })
        .from(jobsTable)
        .where(and(condition, or(sql`${jobsTable.workItemId} IS NULL`, ne(jobsTable.workItemId, workItemId))))
        .get()?.count || 0,
    )
  }

  function preview(workItemId: number): WorkDeletionPreview | null {
    const item = dependencies.work.get(workItemId)
    if (!item) return null
    const ownedJobs = jobs(workItemId)
    const worktrees = [...new Map(ownedJobs.filter((job) => job.worktree_path).map((job) => [job.worktree_path, job])).values()].map(
      (job) => {
        const runtimeAgent = dependencies.agents.require(job.agent_id || dependencies.defaultAgentId)
        const shared = sharedWorktreeCount(workItemId, job.worktree_path) > 0
        const safe =
          isManagedJobWorkspacePath(job, job.worktree_path, runtimeAgent.workspaceRoot, workItemWorkspaceRoot) &&
          resolve(job.base_repo_path) === resolve(job.repository_path)
        return {
          path: job.worktree_path,
          repository: job.full_name,
          removable: !shared && safe,
          reason: shared ? 'Used by another Work item' : safe ? null : 'Outside VertexADE-managed workspace storage',
        }
      },
    )
    const localBranches = [
      ...new Map(
        ownedJobs.filter((job) => job.branch_name && job.base_repo_path).map((job) => [`${job.base_repo_path}\0${job.branch_name}`, job]),
      ).values(),
    ].map((job) => {
      const shared = sharedBranchCount(workItemId, job.base_repo_path, job.branch_name) > 0
      const safe = resolve(job.base_repo_path) === resolve(job.repository_path)
      const branchJobs = ownedJobs.filter(
        (candidate) => candidate.base_repo_path === job.base_repo_path && candidate.branch_name === job.branch_name,
      )
      const blockedByWorktree = branchJobs.some((candidate) =>
        worktrees.some((worktree) => worktree.path === candidate.worktree_path && !worktree.removable),
      )
      return {
        repository: job.full_name,
        branch: job.branch_name,
        removable: !shared && safe && !blockedByWorktree,
        reason: shared
          ? 'Used by another Work item'
          : !safe
            ? 'Base repository path does not match the repository'
            : blockedByWorktree
              ? 'Its worktree is shared or unmanaged'
              : null,
      }
    })
    return {
      work_item: { id: item.id, key: item.key, title: item.title },
      threads: {
        total: ownedJobs.length,
        active: ownedJobs.filter((job) => ['starting', 'running'].includes(job.status)).length,
      },
      worktrees,
      local_branches: localBranches,
      logs: ownedJobs.filter((job) => job.log_path && isPathInside(dependencies.logsRoot, job.log_path)).length,
      logs_retained: ownedJobs.filter((job) => job.log_path && !isPathInside(dependencies.logsRoot, job.log_path)).length,
      memory_file: dependencies.memory?.exists(workItemId) || false,
      preserved_pull_requests: item.resources
        .filter((resource: any) => resource.kind === 'pull_request')
        .map((resource: any) => ({
          label: resource.label,
          url: resource.url,
          state: resource.state,
        })),
      preserves: { repositories: true, pull_requests: true, remote_branches: true },
    }
  }

  function jobCleanupArtifacts(workItemId: number, job: any): CleanupArtifactInput[] {
    const artifacts: CleanupArtifactInput[] = []
    if (job.log_path)
      artifacts.push({
        identity: `job:${job.id}:log`,
        jobId: job.id,
        kind: 'log',
        target: job.log_path,
        metadata: { workItemId },
      })
    if (job.thread_id && !job.ephemeral)
      artifacts.push({
        identity: `job:${job.id}:provider`,
        jobId: job.id,
        kind: 'provider_thread',
        target: job.thread_id,
        metadata: { agentId: job.agent_id || dependencies.defaultAgentId },
      })
    return artifacts
  }

  function workspaceCleanupArtifacts(plan: WorkDeletionPreview, ownedJobs: any[]): CleanupArtifactInput[] {
    const workspaceRoots = [
      ...new Map(
        ownedJobs.filter((job) => job.workspace_mode === 'combined' && job.session_cwd).map((job) => [resolve(job.session_cwd), job]),
      ).keys(),
    ]
    const artifacts: CleanupArtifactInput[] = []
    for (const root of workspaceRoots) {
      const related = ownedJobs.filter((job) => job.workspace_mode === 'combined' && resolve(job.session_cwd || '') === root)
      const removable =
        sharedWorkspaceCount(plan.work_item.id, root) === 0 &&
        related.every((job) => plan.worktrees.find((worktree) => worktree.path === job.worktree_path)?.removable)
      if (removable) artifacts.push({ identity: `workspace:${root}`, kind: 'workspace_root', target: root })
    }
    return artifacts
  }

  function cleanupArtifacts(plan: WorkDeletionPreview, ownedJobs: any[]): CleanupArtifactInput[] {
    const worktrees: CleanupArtifactInput[] = plan.worktrees
      .filter((entry) => entry.removable)
      .map((entry) => ({ identity: `worktree:${entry.path}`, kind: 'worktree', target: entry.path }))
    const branches: CleanupArtifactInput[] = plan.local_branches
      .filter((entry) => entry.removable)
      .map((entry) => ({
        identity: `branch:${entry.repository}:${entry.branch}`,
        kind: 'branch',
        target: `${entry.repository}:${entry.branch}`,
      }))
    const memory: CleanupArtifactInput[] = plan.memory_file
      ? [{ identity: `memory:${plan.work_item.id}`, kind: 'memory', target: String(plan.work_item.id) }]
      : []
    return [
      ...ownedJobs.flatMap((job) => jobCleanupArtifacts(plan.work_item.id, job)),
      ...worktrees,
      ...branches,
      ...workspaceCleanupArtifacts(plan, ownedJobs),
      ...memory,
    ]
  }

  async function removeRegisteredWorktree(job: any) {
    try {
      await withWorktreeOwnershipRepair(dependencies.run, job.worktree_path, () =>
        dependencies.run('git', ['-C', job.base_repo_path, 'worktree', 'remove', '--force', job.worktree_path]),
      )
    } catch (error) {
      if (!(await pathExists(job.worktree_path))) return
      if (!missingWorktreeRegistration(error)) throw error
      await removeDirectory(job.worktree_path)
    }
  }

  async function removeWorktree(job: any) {
    const runtimeAgent = dependencies.agents.require(job.agent_id || dependencies.defaultAgentId)
    assertSafeWorktree(job, runtimeAgent, workItemWorkspaceRoot)
    if (!(await pathExists(job.worktree_path))) return
    if (!(await pathExists(job.base_repo_path))) return removeDirectory(job.worktree_path)
    await removeRegisteredWorktree(job)
    try {
      await dependencies.run('git', ['-C', job.base_repo_path, 'worktree', 'prune'])
    } catch {}
  }

  async function localBranchExists(baseRepoPath: string, branch: string) {
    try {
      await dependencies.run('git', ['-C', baseRepoPath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
      return true
    } catch {
      return false
    }
  }

  async function digest(path: string) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex')
  }

  async function regularLegacyFile(configuredRoot: string, storedPath: string, errorMessage: string) {
    const [rootPath, sourcePath, sourceStats] = await Promise.all([realpath(configuredRoot), realpath(storedPath), lstat(storedPath)])
    if (!isPathInside(rootPath, sourcePath) || !sourceStats.isFile() || sourceStats.isSymbolicLink())
      throw new BlockedCleanupError(errorMessage)
    return sourcePath
  }

  async function matchingLegacyRoot(storedPath: string) {
    for (const root of legacyLogsRoots) {
      try {
        if (isPathInside(await realpath(root), storedPath)) return root
      } catch {
        // An unavailable historical root cannot own the stored source.
      }
    }
    return null
  }

  async function copyLegacyLog(sourcePath: string, target: string) {
    try {
      await copyFile(sourcePath, target, fsConstants.COPYFILE_EXCL)
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error
    }
    const [sourceDigest, targetDigest] = await Promise.all([digest(sourcePath), digest(target)])
    if (sourceDigest !== targetDigest) throw new Error('Legacy log copy failed checksum verification')
  }

  async function removeMigratedSource(sourcePath: string, tombstoneId: number, identity: string) {
    try {
      await removeFile(sourcePath)
      tombstones.complete(tombstoneId, identity)
    } catch (error) {
      tombstones.fail(tombstoneId, identity, error)
      throw error
    }
  }

  async function migrateLegacyLog(job: any, tombstoneId: number) {
    const storedPath = resolve(job.log_path)
    const configuredRoot = legacyLogsRoots.find((root) => isPathInside(root, storedPath))
    if (!configuredRoot) return null
    const sourcePath = await regularLegacyFile(
      configuredRoot,
      storedPath,
      'Legacy log is not a regular file inside an allowlisted historical logs directory',
    )
    const directory = join(dependencies.logsRoot, 'legacy')
    const target = join(directory, `run-${job.id}--${basename(sourcePath)}`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await copyLegacyLog(sourcePath, target)
    tombstones.retargetJobLog(tombstoneId, `job:${job.id}:log`, job.id, sourcePath, target)
    await removeMigratedSource(sourcePath, tombstoneId, `job:${job.id}:legacy-source`)
    return target
  }

  async function removeLegacySources(tombstoneId: number, ownedJobs: any[], state: CleanupState) {
    const sources = tombstones
      .artifacts(tombstoneId, ['pending', 'retrying', 'blocked'])
      .filter((artifact) => artifact.metadata?.legacySource === true)
    for (const artifact of sources) {
      const related = ownedJobs.filter((job) => job.id === artifact.jobId)
      try {
        if (!(await pathExists(artifact.target))) {
          tombstones.complete(tombstoneId, artifact.identity)
          continue
        }
        const storedPath = resolve(artifact.target)
        const configuredRoot = await matchingLegacyRoot(storedPath)
        if (!configuredRoot) throw new BlockedCleanupError('Legacy log source is outside every allowlisted historical logs directory')
        const sourcePath = await regularLegacyFile(
          configuredRoot,
          storedPath,
          'Legacy log source is not a regular file inside its allowlisted directory',
        )
        await removeFile(sourcePath)
        tombstones.complete(tombstoneId, artifact.identity)
      } catch (error) {
        tombstones.fail(tombstoneId, artifact.identity, error, error instanceof BlockedCleanupError)
        block(state, `Thread #${artifact.jobId || 'unknown'}`, error, related)
      }
    }
  }

  async function removeLog(job: any, tombstoneId: number) {
    if (!job.log_path) return 'missing' as const
    if (!isPathInside(dependencies.logsRoot, job.log_path)) {
      if (!(await pathExists(job.log_path))) return 'missing' as const
      const migrated = await migrateLegacyLog(job, tombstoneId)
      if (!migrated) return 'retained' as const
      job.log_path = migrated
    }
    if (!(await pathExists(job.log_path))) return 'missing' as const
    try {
      await removeFile(job.log_path)
      return 'deleted' as const
    } catch (error: any) {
      if (error?.code === 'ENOENT') return 'missing' as const
      throw error
    }
  }

  function block(state: CleanupState, target: string, error: unknown, relatedJobs: any[]) {
    state.errors.push({ target, error: message(error) })
    relatedJobs.forEach((job) => state.blockedJobs.add(job.id))
  }

  async function stopActiveJobs(ownedJobs: any[], state: CleanupState) {
    for (const job of ownedJobs.filter((entry) => ['starting', 'running'].includes(entry.status))) {
      const child = dependencies.activeJobs.get(job.id)
      if (!child) {
        block(
          state,
          `Thread #${job.id}`,
          'The active process is not managed by this server; restart or finish it before retrying deletion',
          [job],
        )
        continue
      }
      try {
        await stopProcess(job, child)
      } catch (error) {
        block(state, `Thread #${job.id}`, `Could not stop the active agent: ${message(error)}`, [job])
      }
    }
  }

  async function removeWorktrees(plan: WorkDeletionPreview, ownedJobs: any[], state: CleanupState, tombstoneId: number) {
    const jobsByWorktree = new Map<string, any[]>()
    for (const job of ownedJobs.filter((entry) => entry.worktree_path)) {
      jobsByWorktree.set(job.worktree_path, [...(jobsByWorktree.get(job.worktree_path) || []), job])
    }
    for (const worktree of plan.worktrees.filter((entry) => entry.removable)) {
      const related = jobsByWorktree.get(worktree.path) || []
      if (artifactFinished(tombstoneId, `worktree:${worktree.path}`)) continue
      if (related.some((job) => state.blockedJobs.has(job.id))) continue
      try {
        const existed = await pathExists(worktree.path)
        await removeWorktree(related[0])
        if (existed) state.worktreesRemoved += 1
        tombstones.complete(tombstoneId, `worktree:${worktree.path}`)
      } catch (error) {
        tombstones.fail(tombstoneId, `worktree:${worktree.path}`, error)
        block(state, worktree.path, error, related)
      }
    }
  }

  async function removeCombinedWorkspaceRoots(
    workItemId: number,
    plan: WorkDeletionPreview,
    ownedJobs: any[],
    state: CleanupState,
    tombstoneId: number,
  ) {
    const roots = [
      ...new Map(
        ownedJobs.filter((job) => job.workspace_mode === 'combined' && job.session_cwd).map((job) => [resolve(job.session_cwd), job]),
      ).values(),
    ]
    for (const rootJob of roots) {
      const root = resolve(rootJob.session_cwd)
      const related = ownedJobs.filter((job) => job.workspace_mode === 'combined' && resolve(job.session_cwd || '') === root)
      if (artifactFinished(tombstoneId, `workspace:${root}`)) continue
      if (related.some((job) => state.blockedJobs.has(job.id))) continue
      if (sharedWorkspaceCount(workItemId, root) > 0) {
        tombstones.complete(tombstoneId, `workspace:${root}`)
        continue
      }
      if (
        related.some((job) => {
          const worktree = plan.worktrees.find((entry) => entry.path === job.worktree_path)
          return !worktree?.removable
        })
      )
        continue
      try {
        for (const job of related) {
          const runtimeAgent = dependencies.agents.require(job.agent_id || dependencies.defaultAgentId)
          if (!isManagedJobWorkspacePath(job, root, runtimeAgent.workspaceRoot, workItemWorkspaceRoot)) {
            throw new Error(`Refusing to remove a combined workspace outside VertexADE-managed storage for ${runtimeAgent.name}`)
          }
          if (!isPathInside(root, job.worktree_path))
            throw new Error('Refusing to remove a combined workspace that does not contain its recorded worktree')
        }
        if (await pathExists(root)) await removeDirectory(root)
        tombstones.complete(tombstoneId, `workspace:${root}`)
      } catch (error) {
        tombstones.fail(tombstoneId, `workspace:${root}`, error)
        block(state, root, error, related)
      }
    }
  }

  async function removeBranches(plan: WorkDeletionPreview, ownedJobs: any[], state: CleanupState, tombstoneId: number) {
    for (const branch of plan.local_branches.filter((entry) => entry.removable)) {
      const related = ownedJobs.filter((job) => job.full_name === branch.repository && job.branch_name === branch.branch)
      if (artifactFinished(tombstoneId, `branch:${branch.repository}:${branch.branch}`)) continue
      if (related.some((job) => state.blockedJobs.has(job.id))) continue
      const job = related[0]
      try {
        if (await localBranchExists(job.base_repo_path, branch.branch)) {
          await dependencies.run('git', ['-C', job.base_repo_path, 'branch', '-D', '--', branch.branch])
          state.branchesDeleted += 1
        }
        tombstones.complete(tombstoneId, `branch:${branch.repository}:${branch.branch}`)
      } catch (error) {
        tombstones.fail(tombstoneId, `branch:${branch.repository}:${branch.branch}`, error)
        block(state, `${branch.repository}:${branch.branch}`, error, related)
      }
    }
  }

  async function removeProviderThread(job: any) {
    if (!job.thread_id || job.ephemeral) return true
    try {
      const runtimeAgent = dependencies.agents.require(job.agent_id || dependencies.defaultAgentId)
      return removeAgentProviderThread(runtimeAgent, job.thread_id, Boolean(job.ephemeral))
    } catch {
      return false
    }
  }

  async function jobLogOutcome(job: any, tombstoneId: number) {
    const identity = `job:${job.id}:log`
    const artifactState = tombstones.artifact(tombstoneId, identity)?.state
    const detached = artifactState === 'detached'
    const outcome = detached
      ? ('retained' as const)
      : artifactState === 'complete'
        ? ('missing' as const)
        : await removeLog(job, tombstoneId)
    return { detached, identity, outcome }
  }

  function recordJobLogOutcome(job: any, state: CleanupState, tombstoneId: number, outcome: string, identity: string) {
    if (outcome === 'deleted') state.logsDeleted += 1
    if (outcome === 'retained') state.logsRetained += 1
    if (job.log_path && outcome !== 'retained') tombstones.complete(tombstoneId, identity)
  }

  async function settleJobLog(job: any, state: CleanupState, tombstoneId: number) {
    const originalLogPath = job.log_path
    const { detached, identity, outcome } = await jobLogOutcome(job, tombstoneId)
    if (originalLogPath !== job.log_path) dependencies.invalidateLog?.(originalLogPath)
    if (job.log_path) dependencies.invalidateLog?.(job.log_path)
    recordJobLogOutcome(job, state, tombstoneId, outcome, identity)
    if (outcome !== 'retained' || detached) return true
    const error = new Error('Log is outside the canonical dashboard logs directory and requires explicit remediation')
    tombstones.fail(tombstoneId, identity, error, true)
    block(state, `Thread #${job.id}`, error, [job])
    return false
  }

  async function settleProviderThread(job: any, state: CleanupState, tombstoneId: number) {
    const identity = `job:${job.id}:provider`
    const artifactState = tombstones.artifact(tombstoneId, identity)?.state
    const detached = artifactState === 'detached'
    const removed = detached || artifactState === 'complete' || (await removeProviderThread(job))
    if (detached) state.providerThreadsRetained += 1
    if (removed) {
      if (job.thread_id && !detached) tombstones.complete(tombstoneId, identity)
      return true
    }
    state.providerThreadsRetained += 1
    const error = new Error('Provider session deletion failed and will be retried')
    tombstones.fail(tombstoneId, identity, error)
    block(state, `Thread #${job.id}`, error, [job])
    return false
  }

  function deleteJobRecord(job: any, state: CleanupState) {
    dependencies.db.update(jobsTable).set({ sourceJobId: null }).where(eq(jobsTable.sourceJobId, job.id)).run()
    dependencies.db.delete(jobsTable).where(eq(jobsTable.id, job.id)).run()
    state.threadsDeleted += 1
  }

  async function removeJob(job: any, state: CleanupState, tombstoneId: number) {
    if (state.blockedJobs.has(job.id)) return
    try {
      if (!(await settleJobLog(job, state, tombstoneId))) return
      if (!(await settleProviderThread(job, state, tombstoneId))) return
      deleteJobRecord(job, state)
    } catch (error) {
      if (job.log_path) tombstones.fail(tombstoneId, `job:${job.id}:log`, error, error instanceof BlockedCleanupError)
      block(state, `Thread #${job.id}`, error, [job])
    }
  }

  async function removeJobs(ownedJobs: any[], state: CleanupState, tombstoneId: number) {
    for (const job of ownedJobs) await removeJob(job, state, tombstoneId)
  }

  function cleanupState(): CleanupState {
    return {
      errors: [],
      blockedJobs: new Set(),
      worktreesRemoved: 0,
      branchesDeleted: 0,
      logsDeleted: 0,
      logsRetained: 0,
      providerThreadsRetained: 0,
      threadsDeleted: 0,
    }
  }

  async function runCleanup(workItemId: number, plan: WorkDeletionPreview, ownedJobs: any[], state: CleanupState, tombstoneId: number) {
    await removeLegacySources(tombstoneId, ownedJobs, state)
    await stopActiveJobs(ownedJobs, state)
    if (dependencies.beforeRemoveJobs) {
      try {
        await dependencies.beforeRemoveJobs(ownedJobs.filter((job) => !state.blockedJobs.has(job.id)))
      } catch (error) {
        block(state, 'Container previews', error, ownedJobs)
      }
    }
    await removeWorktrees(plan, ownedJobs, state, tombstoneId)
    await removeCombinedWorkspaceRoots(workItemId, plan, ownedJobs, state, tombstoneId)
    await removeBranches(plan, ownedJobs, state, tombstoneId)
    await removeJobs(ownedJobs, state, tombstoneId)
  }

  function remainingJobs(workItemId: number) {
    return Number(
      dependencies.db
        .select({ count: sql<number>`count(*)` })
        .from(jobsTable)
        .where(eq(jobsTable.workItemId, workItemId))
        .get()?.count || 0,
    )
  }

  async function removeMemory(workItemId: number, plan: WorkDeletionPreview, state: CleanupState, tombstoneId: number) {
    if (!dependencies.memory) return false
    try {
      const memoryState = tombstones.artifact(tombstoneId, `memory:${workItemId}`)?.state
      if (['complete', 'detached'].includes(memoryState || '')) return false
      const deleted = await dependencies.memory.remove(workItemId)
      if (plan.memory_file) tombstones.complete(tombstoneId, `memory:${workItemId}`)
      return deleted
    } catch (error) {
      if (plan.memory_file) tombstones.fail(tombstoneId, `memory:${workItemId}`, error)
      state.errors.push({ target: 'Shared Work memory', error: message(error) })
      return false
    }
  }

  function deletionResult(
    plan: WorkDeletionPreview,
    state: CleanupState,
    tombstoneId: number,
    memoryDeleted: boolean,
    deleted: boolean,
  ): WorkDeletionResult {
    const cleanup = tombstones.refresh(tombstoneId)!
    return {
      deleted,
      cleanup_complete: cleanup.pending === 0,
      cleanup_tombstone_id: tombstoneId,
      cleanup_pending: cleanup.pending,
      cleanup_next_retry_at: cleanup.next_retry_at,
      cleanup_artifacts: cleanup.artifacts
        .filter((artifact) => !['complete', 'detached'].includes(artifact.state))
        .map((artifact) => ({
          id: artifact.id,
          kind: artifact.kind,
          target: artifact.target,
          state: artifact.state,
          attempts: artifact.attempts,
          next_retry_at: artifact.nextRetryAt,
          error: artifact.lastError,
        })),
      work_item_key: plan.work_item.key,
      threads_deleted: state.threadsDeleted,
      worktrees_removed: state.worktreesRemoved,
      local_branches_deleted: state.branchesDeleted,
      logs_deleted: state.logsDeleted,
      logs_retained: state.logsRetained,
      provider_threads_retained: state.providerThreadsRetained,
      memory_deleted: memoryDeleted,
      shared_worktrees_retained: plan.worktrees.filter((entry) => !entry.removable && entry.reason?.includes('another Work')).length,
      shared_branches_retained: plan.local_branches.filter((entry) => !entry.removable && entry.reason?.includes('another Work')).length,
      preserved_pull_requests: plan.preserved_pull_requests,
      errors: state.errors,
    }
  }

  async function remove(workItemId: number): Promise<WorkDeletionResult> {
    const plan = preview(workItemId)
    if (!plan) throw new Error('Work item not found')
    const ownedJobs = jobs(workItemId)
    const tombstoneId = tombstones.ensure(plan.work_item, cleanupArtifacts(plan, ownedJobs))
    const state = cleanupState()
    await runCleanup(workItemId, plan, ownedJobs, state, tombstoneId)
    const remaining = remainingJobs(workItemId)
    const memoryDeleted = remaining === 0 && state.errors.length === 0 ? await removeMemory(workItemId, plan, state, tombstoneId) : false
    const cleanup = tombstones.refresh(tombstoneId)!
    const deleted = remaining === 0 && state.errors.length === 0 && cleanup.pending === 0
    if (deleted) dependencies.work.permanentlyDelete(workItemId)
    else dependencies.work.deletionFailed(workItemId, state.errors)
    return deletionResult(plan, state, tombstoneId, memoryDeleted, deleted)
  }

  const mergedWorktrees = createMergedWorktreeCleanup(dependencies)

  async function recoverDue() {
    for (const workItemId of tombstones.dueWorkItemIds()) {
      try {
        if (dependencies.work.raw(workItemId)) await remove(workItemId)
      } catch (error) {
        console.error(`Could not retry cleanup for Work #${workItemId}:`, error)
      }
    }
  }

  function startRecovery(intervalMs = 30_000) {
    if (recoveryTimer) return
    void recoverDue()
    recoveryTimer = setInterval(() => void recoverDue(), intervalMs)
    recoveryTimer.unref()
  }

  function stopRecovery() {
    if (recoveryTimer) clearInterval(recoveryTimer)
    recoveryTimer = undefined
  }

  return {
    preview,
    remove,
    removeMergedWorktrees: mergedWorktrees.removeMerged,
    recoverDue,
    startRecovery,
    stopRecovery,
    incomplete: () => tombstones.listIncomplete(),
    detachArtifact: (artifactId: number, workKey: string) => tombstones.detach(artifactId, workKey),
  }
}

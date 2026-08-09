import type { CapabilityValue, ScmProvider } from '@vertexade/platform-contracts'
import { and, desc, eq } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { automationFlowRuns, jobs, pullRequests, repositories } from '../database/schema/tables.ts'
import type { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'

type CommandRunner = (command: string, args: string[], options?: { cwd?: string }) => Promise<string>

type DraftPullRequestDependencies = {
  run: CommandRunner
  scm(repository: string): ScmProvider
  created?(repository: Record<string, unknown>): Promise<void>
}

type DraftPullRequestTarget = {
  run_id: number
  job_id: number
  status: string
  exit_code: number | null
  kind: string
  task_title: string
  branch_name: string | null
  worktree_path: string
  head_sha: string
  repo_id: number
  full_name: string
  clone_url: string
  local_path: string
}
type PublishableTarget = Omit<DraftPullRequestTarget, 'branch_name'> & { branch_name: string }

function valueRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, CapabilityValue>) : {}
}

function requireTarget(database: DrizzleDashboardDatabase, workflowInstanceId?: number | null): PublishableTarget {
  if (!workflowInstanceId) throw new Error('Draft pull requests require an automation flow run')
  const target = database
    .select({
      run_id: automationFlowRuns.id,
      job_id: jobs.id,
      status: jobs.status,
      exit_code: jobs.exitCode,
      kind: jobs.kind,
      task_title: jobs.taskTitle,
      branch_name: jobs.branchName,
      worktree_path: jobs.worktreePath,
      head_sha: jobs.headSha,
      repo_id: repositories.id,
      full_name: repositories.fullName,
      clone_url: repositories.cloneUrl,
      local_path: repositories.localPath,
    })
    .from(automationFlowRuns)
    .innerJoin(jobs, eq(jobs.id, automationFlowRuns.threadJobId))
    .innerJoin(repositories, eq(repositories.id, jobs.repoId))
    .where(eq(automationFlowRuns.id, workflowInstanceId))
    .get() as DraftPullRequestTarget | undefined
  if (!target) throw new Error('The automation flow no longer has a repository thread')
  if (target.status !== 'completed' || target.exit_code !== 0)
    throw new Error('The automation thread must complete successfully before creating a pull request')
  if (['review', 'work_review'].includes(target.kind)) throw new Error('Review threads cannot publish pull requests')
  if (!target.branch_name) throw new Error('The automation thread does not have a publishable branch')
  return target as PublishableTarget
}

async function defaultBase(run: CommandRunner, target: PublishableTarget) {
  const ref = (await run('git', ['-C', target.worktree_path, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
  const branch = ref.replace(/^origin\//, '')
  if (!branch) throw new Error('Could not determine the pull request base branch')
  return branch
}

async function validateWorktree(run: CommandRunner, target: PublishableTarget) {
  const status = await run('git', ['-C', target.worktree_path, 'status', '--porcelain'])
  if (status.trim()) throw new Error('Commit all repository changes before the bound pull request action can run')
  const ahead = Number((await run('git', ['-C', target.worktree_path, 'rev-list', '--count', `${target.head_sha}..HEAD`])).trim())
  if (!Number.isInteger(ahead) || ahead < 1) throw new Error('The automation branch has no commits to publish')
}

function existingPullRequest(database: DrizzleDashboardDatabase, target: PublishableTarget, input: Record<string, CapabilityValue>) {
  const existing = database
    .select({ number: pullRequests.number, url: pullRequests.url, base_ref: pullRequests.baseRef, draft: pullRequests.draft })
    .from(pullRequests)
    .where(and(eq(pullRequests.repoId, target.repo_id), eq(pullRequests.headRef, target.branch_name)))
    .orderBy(desc(pullRequests.number))
    .limit(1)
    .get()
  if (!existing) return null
  return {
    ...existing,
    repository: target.full_name,
    branch: target.branch_name,
    base: String(existing.base_ref || input.baseBranch || ''),
    draft: Boolean(existing.draft),
  }
}

async function publishDraftPullRequest(
  target: PublishableTarget,
  input: Record<string, CapabilityValue>,
  dependencies: DraftPullRequestDependencies,
) {
  await validateWorktree(dependencies.run, target)
  const base = String(input.baseBranch || '').trim() || (await defaultBase(dependencies.run, target))
  await dependencies.run('git', ['-C', target.worktree_path, 'push', '--set-upstream', 'origin', target.branch_name])
  const provider = dependencies.scm(target.full_name)
  if (!provider.createPullRequest) throw new Error(`${provider.name} cannot create pull requests`)
  const result = await provider.createPullRequest({
    repository: target.full_name,
    head: target.branch_name,
    base,
    title: String(input.title || target.task_title || `Automated change for ${target.full_name}`).slice(0, 200),
    body: String(input.body || `Created by automation flow run #${target.run_id}.`).slice(0, 20_000),
    draft: true,
  })
  await dependencies.created?.(target as unknown as Record<string, unknown>)
  return { ...result, repository: target.full_name, branch: target.branch_name, base, draft: true }
}

export function registerCoreAutomationActions(
  database: DrizzleDashboardDatabase,
  registries: PlatformCapabilityRegistries,
  dependencies: DraftPullRequestDependencies,
) {
  registries.forModule('core').actions.register({
    id: 'core.create-draft-pr',
    name: 'Create draft pull request',
    description: 'Publish the completed automation branch as a draft PR after hard runtime checks pass.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', maxLength: 200 },
        body: { type: 'string', maxLength: 20_000 },
        baseBranch: { type: 'string', maxLength: 255 },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['repository', 'branch', 'base', 'draft'],
      additionalProperties: true,
      properties: {
        repository: { type: 'string' },
        branch: { type: 'string' },
        base: { type: 'string' },
        draft: { type: 'boolean' },
        url: { type: 'string' },
      },
    },
    timeoutMs: 120_000,
    async execute(rawInput, context) {
      const input = valueRecord(rawInput)
      const target = requireTarget(database, context.workflowInstanceId)
      return existingPullRequest(database, target, input) || publishDraftPullRequest(target, input, dependencies)
    },
  })
}

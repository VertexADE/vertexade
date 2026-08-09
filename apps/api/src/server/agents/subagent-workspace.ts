import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { Agent } from '@vertexade/platform-contracts'

type RunOptions = { input?: string; maxOutputBytes?: number }
type Run = (command: string, args: string[], options?: RunOptions) => Promise<string>
type ParentJob = {
  id: number
  repo_id: number
  work_item_id?: number | null
  worktree_path: string
}
type ChildJob = {
  worktree_path: string
  subagent_base_sha: string
}
type Repository = {
  id: number
  full_name: string
  local_path: string
}
type Allocation = {
  worktree: string
  baseGitDir: string
  sessionCwd: string
}

type CreateDependencies = {
  repository(id: number): Repository | null
  run: Run
  createWorktree(
    repository: Repository,
    runtimeAgent: Readonly<Agent>,
    revision: string,
    branchName: string,
    workspace: { mode: 'combined'; workItemKey: string; isolationKey: string },
  ): Promise<Allocation>
  populateSnapshot(source: string, destination: string, run: Run): Promise<void>
  cleanup(repositoryPath: string, worktreePath: string | null, branchName: string): Promise<void>
}

type IntegrateDependencies = { run: Run }

function branchSlug(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 28) || 'task'
  )
}

export async function createSubagentWorkspace(
  parent: ParentJob,
  runtimeAgent: Readonly<Agent>,
  title: string,
  dependencies: CreateDependencies,
) {
  const repository = dependencies.repository(parent.repo_id)
  if (!repository) throw new Error('The parent repository no longer exists')
  if (!parent.work_item_id) throw new Error('The parent run is not owned by a Work item')
  const revision = (await dependencies.run('git', ['-C', parent.worktree_path, 'rev-parse', 'HEAD'])).trim()
  const branchName = `subagent/${parent.id}-${branchSlug(title)}-${randomUUID().slice(0, 8)}`
  let worktree: string | null = null
  try {
    const allocation = await dependencies.createWorktree(repository, runtimeAgent, revision, branchName, {
      mode: 'combined',
      workItemKey: `W-${String(parent.work_item_id).padStart(4, '0')}`,
      isolationKey: `subagent-${parent.id}-${randomUUID().slice(0, 8)}`,
    })
    worktree = allocation.worktree
    await dependencies.populateSnapshot(parent.worktree_path, worktree, dependencies.run)
    await dependencies.run('git', ['-C', worktree, 'add', '--all'])
    await dependencies.run('git', [
      '-C',
      worktree,
      '-c',
      'user.name=VertexADE',
      '-c',
      'user.email=vertexade@local',
      'commit',
      '--allow-empty',
      '--no-verify',
      '-m',
      `chore: snapshot parent run ${parent.id}`,
    ])
    const baselineSha = (await dependencies.run('git', ['-C', worktree, 'rev-parse', 'HEAD'])).trim()
    return { worktree, sessionCwd: allocation.sessionCwd, baseGitDir: allocation.baseGitDir, baselineSha, branchName }
  } catch (error) {
    await dependencies.cleanup(repository.local_path, worktree, branchName)
    throw error
  }
}

export async function integrateSubagentWorkspace(parent: ParentJob, child: ChildJob, dependencies: IntegrateDependencies) {
  await Promise.all([stat(parent.worktree_path), stat(child.worktree_path)])
  try {
    await dependencies.run('git', ['-C', child.worktree_path, 'add', '--intent-to-add', '--all'])
  } catch {}
  const maximumPatchBytes = 50 * 1024 * 1024
  const patch = await dependencies.run('git', ['-C', child.worktree_path, 'diff', '--binary', child.subagent_base_sha, '--'], {
    maxOutputBytes: maximumPatchBytes,
  })
  const files = (await dependencies.run('git', ['-C', child.worktree_path, 'diff', '--name-only', child.subagent_base_sha, '--']))
    .split(/\r?\n/)
    .filter(Boolean)
  if (!patch.trim()) return { applied: false, files }
  await dependencies.run('git', ['-C', parent.worktree_path, 'apply', '--3way', '--check', '--whitespace=nowarn', '-'], {
    input: patch,
    maxOutputBytes: maximumPatchBytes,
  })
  await dependencies.run('git', ['-C', parent.worktree_path, 'apply', '--3way', '--whitespace=nowarn', '-'], {
    input: patch,
    maxOutputBytes: maximumPatchBytes,
  })
  return { applied: true, files }
}

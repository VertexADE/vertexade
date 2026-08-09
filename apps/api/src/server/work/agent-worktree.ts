import { randomUUID } from 'node:crypto'
import { mkdir, rm, rmdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseWorkItemWorkspaceMode, workItemWorkspaceLayout } from './workspace-layout.ts'

type Repository = { full_name: string; local_path: string }
type RuntimeAgent = { workspaceRoot: string }
type Run = (command: string, args: string[]) => Promise<string>

type Dependencies = {
  run: Run
  prepare(repository: Repository, worktree: string, agent: RuntimeAgent): Promise<void>
  cleanup(repositoryPath: string, worktreePath: string | null, branchName?: string | null): Promise<void>
}

type AllocationInput = {
  repository: Repository
  agent: RuntimeAgent
  revision: string
  branchName: string | null
  mode: 'combined' | 'repository'
  root: string
  worktree: string
  baseGitDir: string
  isolated: boolean
}

async function commonGitDirectory(run: Run, path: string) {
  return resolve((await run('git', ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'])).trim())
}

async function reuseCombinedWorktree(input: AllocationInput, run: Run) {
  try {
    await stat(input.worktree)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  const worktreeGitDir = await commonGitDirectory(run, input.worktree)
  if (worktreeGitDir !== input.baseGitDir) throw new Error('The existing combined worktree belongs to a different repository')
  const existingBranch = (await run('git', ['-C', input.worktree, 'branch', '--show-current'])).trim() || null
  if (input.branchName && !existingBranch) {
    throw new Error(`${input.repository.full_name} has a read-only combined worktree; remove it before starting implementation`)
  }
  const headSha = (await run('git', ['-C', input.worktree, 'rev-parse', 'HEAD'])).trim()
  return {
    worktree: input.worktree,
    baseGitDir: input.baseGitDir,
    sessionCwd: input.root,
    workspaceMode: input.mode,
    branchName: existingBranch,
    headSha,
    created: false,
  }
}

async function reserveCombinedPath(input: AllocationInput) {
  if (input.mode !== 'combined') return false
  await mkdir(input.root, { recursive: true })
  try {
    await mkdir(input.worktree)
    return true
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      throw new Error(`${input.repository.full_name} is preparing its combined worktree; retry after the current launch finishes`)
    }
    throw error
  }
}

async function removeFailedReservation(input: AllocationInput, reserved: boolean) {
  if (input.mode !== 'combined') return
  if (reserved) {
    try {
      await rm(input.worktree, { recursive: true, force: true })
    } catch {}
  }
  try {
    await rmdir(input.root)
  } catch {}
}

async function createWorktree(input: AllocationInput, dependencies: Dependencies) {
  const reserved = await reserveCombinedPath(input)
  try {
    await dependencies.run('git', [
      '-C',
      input.repository.local_path,
      'worktree',
      'add',
      ...(input.branchName ? ['-b', input.branchName, input.worktree, input.revision] : ['--detach', input.worktree, input.revision]),
    ])
    await dependencies.prepare(input.repository, input.worktree, input.agent)
    const worktreeGitDir = await commonGitDirectory(dependencies.run, input.worktree)
    if (worktreeGitDir !== input.baseGitDir) throw new Error('Created worktree does not share Git metadata with the original repository')
    return {
      worktree: input.worktree,
      baseGitDir: input.baseGitDir,
      sessionCwd: input.root,
      workspaceMode: input.mode,
      branchName: input.branchName,
      headSha: input.revision,
      created: true,
    }
  } catch (error) {
    await dependencies.cleanup(input.repository.local_path, input.worktree, input.branchName)
    await removeFailedReservation(input, reserved)
    throw error
  }
}

export async function allocateAgentWorktree(
  repository: Repository,
  agent: RuntimeAgent,
  revision: string,
  branchName: string | null,
  workspace: { mode?: unknown; workItemKey?: string; isolationKey?: string },
  dependencies: Dependencies,
) {
  const mode = parseWorkItemWorkspaceMode(workspace.mode, 'repository')
  const layout = workItemWorkspaceLayout({
    agentWorkspaceRoot: agent.workspaceRoot,
    workItemKey: String(workspace.workItemKey || 'work'),
    repositoryFullName: repository.full_name,
    repositoryPath: repository.local_path,
    mode,
    identifier: randomUUID(),
    isolationKey: workspace.isolationKey,
  })
  await dependencies.run('git', ['-C', repository.local_path, 'config', 'extensions.worktreeConfig', 'true'])
  const input: AllocationInput = {
    repository,
    agent,
    revision,
    branchName,
    mode,
    root: layout.root,
    worktree: layout.worktree,
    baseGitDir: await commonGitDirectory(dependencies.run, repository.local_path),
    isolated: Boolean(workspace.isolationKey),
  }
  if (mode === 'combined' && !input.isolated) {
    const reused = await reuseCombinedWorktree(input, dependencies.run)
    if (reused) return reused
  }
  return createWorktree(input, dependencies)
}

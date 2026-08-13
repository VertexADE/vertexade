import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, realpath, rm, rmdir, stat, symlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { vertexWorkItemDirectory } from '@vertexade/platform-server/configuration'
import type { AgentWorkspaceContext } from '@vertexade/platform-contracts'
import { parseWorkItemWorkspaceMode, workItemWorkspaceLayout } from './workspace-layout.ts'

type Repository = {
  full_name: string
  local_path: string
  source_kind?: 'git' | 'directory' | 'workspace'
  workspace_strategy?: 'worktree' | 'direct' | 'copy' | 'move'
}
type RuntimeAgent = { workspaceRoot: string }
type Run = (command: string, args: string[]) => Promise<string>

type Dependencies = {
  run: Run
  workItemWorkspaceRoot?: string
  assertReusable?(repository: Repository, worktree: string): Promise<void> | void
  prepare(repository: Repository, workspace: AgentWorkspaceContext, agent: RuntimeAgent): Promise<void>
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
    await dependencies.prepare(input.repository, { path: input.worktree, sourceKind: 'git', strategy: 'worktree' }, input.agent)
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
  workspace: { mode?: unknown; workItemKey?: string },
  dependencies: Dependencies,
) {
  const strategy = repository.workspace_strategy || 'worktree'
  const mode = parseWorkItemWorkspaceMode(workspace.mode, 'repository')
  const layout = workItemWorkspaceLayout({
    agentWorkspaceRoot: agent.workspaceRoot,
    workItemWorkspaceRoot: dependencies.workItemWorkspaceRoot || vertexWorkItemDirectory(),
    workItemKey: String(workspace.workItemKey || 'work'),
    repositoryFullName: repository.full_name,
    repositoryPath: repository.local_path,
    mode,
    identifier: randomUUID(),
  })
  if (strategy === 'direct') {
    await mkdir(dirname(layout.worktree), { recursive: true })
    try {
      const existing = await lstat(layout.worktree)
      if (!existing.isSymbolicLink() || (await realpath(layout.worktree)) !== (await realpath(repository.local_path))) {
        throw new Error(`${repository.full_name} already has a different Work-item workspace`)
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
      await symlink(repository.local_path, layout.worktree, 'dir')
    }
    const sourceKind = repository.source_kind || 'git'
    const workspace: AgentWorkspaceContext =
      sourceKind === 'git'
        ? { path: layout.worktree, sourceKind: 'git', strategy: 'direct' }
        : { path: layout.worktree, sourceKind, strategy: 'direct' }
    await dependencies.prepare(repository, workspace, agent)
    return {
      worktree: layout.worktree,
      baseGitDir: sourceKind === 'git' ? await commonGitDirectory(dependencies.run, repository.local_path) : null,
      sessionCwd: layout.root,
      workspaceMode: mode,
      branchName: null,
      headSha: sourceKind === 'git' ? revision : null,
      created: false,
      workspaceStrategy: strategy,
    }
  }
  if (repository.source_kind === 'directory' || repository.source_kind === 'workspace') {
    if (!['copy', 'move'].includes(strategy)) throw new Error('Plain directories require direct, copy, or move workspace mode')
    const directoryStrategy = strategy === 'copy' ? 'copy' : 'move'
    await mkdir(layout.root, { recursive: true })
    await cp(repository.local_path, layout.worktree, { recursive: true, errorOnExist: true, force: false })
    await cp(repository.local_path, `${layout.worktree}.baseline`, { recursive: true, errorOnExist: true, force: false })
    await dependencies.prepare(
      repository,
      { path: layout.worktree, sourceKind: repository.source_kind, strategy: directoryStrategy },
      agent,
    )
    return {
      worktree: layout.worktree,
      baseGitDir: null,
      sessionCwd: layout.root,
      workspaceMode: mode,
      branchName: null,
      headSha: null,
      created: true,
      workspaceStrategy: strategy,
    }
  }
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
  }
  if (mode === 'combined') {
    const reused = await reuseCombinedWorktree(input, dependencies.run)
    if (reused) {
      await dependencies.assertReusable?.(repository, input.worktree)
      await dependencies.prepare(repository, { path: input.worktree, sourceKind: 'git', strategy: 'worktree' }, agent)
      return reused
    }
  }
  return createWorktree(input, dependencies)
}

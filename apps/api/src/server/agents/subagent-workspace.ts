import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

type RunOptions = { input?: string; maxOutputBytes?: number }
type Run = (command: string, args: string[], options?: RunOptions) => Promise<string>
type ParentJob = {
  id: number
  repo_id: number
  work_item_id?: number | null
  worktree_path: string
  session_cwd?: string | null
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
type CreateDependencies = {
  repository(id: number): Repository | null
  run: Run
}

type IntegrateDependencies = { run: Run }

export async function createSubagentWorkspace(parent: ParentJob, dependencies: CreateDependencies) {
  const repository = dependencies.repository(parent.repo_id)
  if (!repository) throw new Error('The parent repository no longer exists')
  if (!parent.work_item_id) throw new Error('The parent run is not owned by a Work item')
  if (!parent.session_cwd) throw new Error('The parent run does not have a reusable Work item workspace')
  await stat(parent.worktree_path)
  const baseGitDir = resolve(
    (await dependencies.run('git', ['-C', repository.local_path, 'rev-parse', '--path-format=absolute', '--git-common-dir'])).trim(),
  )
  const worktreeGitDir = resolve(
    (await dependencies.run('git', ['-C', parent.worktree_path, 'rev-parse', '--path-format=absolute', '--git-common-dir'])).trim(),
  )
  if (worktreeGitDir !== baseGitDir) throw new Error('The parent worktree no longer belongs to its recorded repository')
  const baselineSha = (await dependencies.run('git', ['-C', parent.worktree_path, 'rev-parse', 'HEAD'])).trim()
  const branchName = (await dependencies.run('git', ['-C', parent.worktree_path, 'branch', '--show-current'])).trim() || null
  return {
    worktree: parent.worktree_path,
    sessionCwd: parent.session_cwd,
    baseGitDir,
    baselineSha,
    branchName,
  }
}

export async function integrateSubagentWorkspace(parent: ParentJob, child: ChildJob, dependencies: IntegrateDependencies) {
  await Promise.all([stat(parent.worktree_path), stat(child.worktree_path)])
  const maximumPatchBytes = 50 * 1024 * 1024
  if (resolve(parent.worktree_path) === resolve(child.worktree_path)) {
    const [changed, untracked] = await Promise.all([
      dependencies.run('git', ['-C', child.worktree_path, 'diff', '--name-only', child.subagent_base_sha, '--'], {
        maxOutputBytes: maximumPatchBytes,
      }),
      dependencies.run('git', ['-C', child.worktree_path, 'ls-files', '--others', '--exclude-standard'], {
        maxOutputBytes: maximumPatchBytes,
      }),
    ])
    const files = [...new Set(`${changed}\n${untracked}`.split(/\r?\n/).filter(Boolean))].sort()
    return { applied: files.length > 0, files }
  }
  try {
    await dependencies.run('git', ['-C', child.worktree_path, 'add', '--intent-to-add', '--all'])
  } catch {}
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

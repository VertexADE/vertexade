import { basename, join, relative, resolve, sep } from 'node:path'
import type { WorkItemWorkspaceMode } from '@vertexade/platform-contracts'
import { vertexWorkItemDirectory } from '@vertexade/platform-server/configuration'

const DEFAULT_WORK_ITEM_WORKSPACE_MODE: WorkItemWorkspaceMode = 'combined'
type RecordedWorkspaceMode = WorkItemWorkspaceMode | 'repository'

function safeSegment(value: string, fallback: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^[._-]+|[._-]+$/g, '') || fallback
  )
}

function inside(parent: string, child: string) {
  const root = resolve(parent)
  const candidate = resolve(child)
  return candidate !== root && candidate.startsWith(`${root}${sep}`)
}

export function parseWorkItemWorkspaceMode(
  value: unknown,
  fallback: RecordedWorkspaceMode = DEFAULT_WORK_ITEM_WORKSPACE_MODE,
): RecordedWorkspaceMode {
  if (value === undefined || value === null || value === '') return fallback
  if (value === 'combined' || value === 'repository') return value
  throw new Error('Choose combined or repository workspace mode')
}

export function workItemLaunchWorkspaceMode(value: unknown): 'combined' {
  if (value === undefined || value === null || value === '' || value === 'combined') return 'combined'
  if (value === 'repository') {
    throw new Error('Repository-scoped Work folders have been removed; Work runs always use the Work item folder')
  }
  throw new Error('Work runs always use the Work item folder')
}

export function workItemWorkspaceLayout(input: {
  agentWorkspaceRoot: string
  workItemWorkspaceRoot: string
  workItemKey: string
  repositoryFullName: string
  repositoryPath: string
  mode: RecordedWorkspaceMode
  identifier: string
}) {
  if (input.mode === 'repository') {
    const identifier = safeSegment(input.identifier, 'run')
    const worktree = join(input.agentWorkspaceRoot, identifier, basename(input.repositoryPath))
    return { mode: input.mode, root: worktree, worktree }
  }

  const workItemRoot = join(input.workItemWorkspaceRoot, safeSegment(input.workItemKey, 'work'))
  const repository = safeSegment(input.repositoryFullName.replaceAll('/', '--'), basename(input.repositoryPath) || 'repository')
  const worktree = join(workItemRoot, repository)
  if (!inside(input.workItemWorkspaceRoot, workItemRoot) || !inside(workItemRoot, worktree)) {
    throw new Error('Work item workspace must stay inside the VertexADE Work item directory')
  }
  return { mode: input.mode, root: workItemRoot, worktree }
}

type RecordedJobWorkspace = { workspace_mode?: unknown; session_cwd?: unknown; worktree_path: string }

export function isManagedJobWorkspacePath(
  job: Pick<RecordedJobWorkspace, 'workspace_mode'>,
  path: string,
  agentWorkspaceRoot: string,
  workItemWorkspaceRoot: string = vertexWorkItemDirectory(),
): boolean {
  const mode = parseWorkItemWorkspaceMode(job.workspace_mode, 'repository')
  return inside(agentWorkspaceRoot, path) || (mode === 'combined' && inside(workItemWorkspaceRoot, path))
}

export function jobSessionCwd(
  job: RecordedJobWorkspace,
  agentWorkspaceRoot: string,
  workItemWorkspaceRoot: string = vertexWorkItemDirectory(),
): string {
  const mode = parseWorkItemWorkspaceMode(job.workspace_mode, 'repository')
  const worktree = resolve(job.worktree_path)
  const cwd = resolve(mode === 'combined' ? String(job.session_cwd || '') : job.worktree_path)
  if (!isManagedJobWorkspacePath(job, worktree, agentWorkspaceRoot, workItemWorkspaceRoot)) {
    throw new Error('The recorded worktree is outside VertexADE-managed workspace storage')
  }
  if (mode === 'combined') {
    if (!job.session_cwd || !isManagedJobWorkspacePath(job, cwd, agentWorkspaceRoot, workItemWorkspaceRoot) || !inside(cwd, worktree)) {
      throw new Error('The Work item workspace does not contain its recorded repository worktree')
    }
  } else if (cwd !== worktree) {
    throw new Error('Repository workspace sessions must start inside their recorded worktree')
  }
  return cwd
}

export function relativeWorktreePath(root: string, worktree: string) {
  return relative(root, worktree) || basename(worktree)
}

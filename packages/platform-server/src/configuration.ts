import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function commaSeparatedValues(value: string | undefined) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function vertexDataDirectory(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.VERTEXADE_DATA_DIR) return resolve(environment.VERTEXADE_DATA_DIR)
  return environment.XDG_DATA_HOME ? join(resolve(environment.XDG_DATA_HOME), 'vertex-ade') : join(homedir(), '.vertex-ade')
}

export function vertexWorkItemDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  return join(vertexDataDirectory(environment), 'work-items')
}

export function vertexWorktreeDirectory(agentId: string, fallback: string, environment: NodeJS.ProcessEnv = process.env) {
  const root = environment.VERTEXADE_WORKTREE_ROOT
  return root ? join(resolve(root), agentId) : fallback
}

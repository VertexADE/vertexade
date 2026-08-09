export type WorkCleanupArtifact = {
  id: number
  kind: 'log' | 'provider_thread' | 'worktree' | 'branch' | 'memory' | 'workspace_root'
  target: string
  state: 'pending' | 'retrying' | 'blocked' | 'detached' | 'complete'
  attempts: number
  next_retry_at: string | null
  error: string | null
}

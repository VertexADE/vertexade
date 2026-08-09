export function pullRequestStatusTone(status: string) {
  const value = status.toUpperCase()
  if (['SUCCESS', 'COMPLETED', 'APPROVED', 'MERGEABLE', 'CLEAN'].includes(value)) return 'border-emerald-500/40 text-emerald-400'
  if (['FAILURE', 'FAILED', 'ERROR', 'CHANGES_REQUESTED', 'CONFLICTING', 'DIRTY'].includes(value)) return 'border-red-500/40 text-red-400'
  if (['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED'].includes(value)) return 'border-amber-500/40 text-amber-400'
  return 'text-muted-foreground'
}

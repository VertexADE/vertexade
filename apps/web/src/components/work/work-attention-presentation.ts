import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'

export type WorkAttentionKind = 'input' | 'rereview' | 'run_failed' | 'repository_sync' | 'cleanup' | 'preview' | 'general'

export type WorkAttentionPresentation = {
  kind: WorkAttentionKind
  title: string
  summary: string
  technicalDetails: string | null
}

function presentation(kind: WorkAttentionKind, title: string, summary: string, raw: string): WorkAttentionPresentation {
  return {
    kind,
    title,
    summary,
    technicalDetails: raw === summary ? null : raw,
  }
}

export function workAttentionPresentation(item: Pick<WorkItem, 'attention'>): WorkAttentionPresentation | null {
  const raw = item.attention?.trim()
  if (!raw) return null
  const normalized = raw.toLowerCase()

  if (normalized.includes('new commits need re-review'))
    return presentation('rereview', 'New commits need review', 'Review the latest revision before this outcome can move forward.', raw)

  if (normalized.includes('waiting for your input'))
    return presentation('input', 'The agent is waiting for you', 'Answer the open question so work can continue.', raw)

  if (normalized.includes('a thread failed'))
    return presentation(
      'run_failed',
      'An agent thread needs recovery',
      'Inspect the failed thread, then retry or continue from its saved context.',
      raw,
    )

  if (
    normalized.includes('incorrect old value') ||
    normalized.includes('fetching ref') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('repository sync') ||
    normalized.includes('clone unavailable')
  )
    return presentation(
      'repository_sync',
      'Repository sync needs a retry',
      'The repository changed while VertexADE was refreshing it. Retry the agent from the existing Work item.',
      raw,
    )

  if (normalized.includes('container preview') && normalized.includes('no such file'))
    return presentation(
      'preview',
      'The saved preview is no longer available',
      'The underlying preview file disappeared. Open Work to recreate or remove the stale preview link.',
      raw,
    )

  if (
    normalized.includes('refusing to remove a log') ||
    normalized.includes('failed to delete session') ||
    normalized.includes('cleanup is incomplete')
  )
    return presentation(
      'cleanup',
      'Local cleanup needs attention',
      'The Work history is safe, but disposable local state could not be removed. Review the cleanup details before retrying.',
      raw,
    )

  const firstLine =
    raw
      .split('\n')
      .find((line) => line.trim())
      ?.trim() || raw
  const summary = firstLine.length > 180 ? `${firstLine.slice(0, 177)}…` : firstLine
  return presentation('general', 'Work needs your attention', summary, raw)
}

export function attentionRetryLabel(item: Pick<WorkItem, 'kind'>, kind: WorkAttentionKind) {
  if (kind === 'rereview') return 'Re-review'
  if (kind === 'repository_sync') return item.kind === 'pr_review' ? 'Retry review' : 'Retry agent'
  return null
}

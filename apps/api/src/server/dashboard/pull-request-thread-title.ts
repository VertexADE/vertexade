const unusableTitles = new Set(['null', 'undefined'])

function usablePullRequestTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value.replace(/\s+/g, ' ').trim()
  if (!title || unusableTitles.has(title.toLowerCase())) return null
  return title
}

export function pullRequestThreadTitle(kind: string, pullRequest: { number: number; title?: unknown }): string {
  const prefix = kind === 'review' || kind === 'review_handoff' ? 'Review' : 'Work on'
  const title = usablePullRequestTitle(pullRequest.title)
  return `${prefix} PR #${pullRequest.number}${title ? `: ${title}` : ''}`.slice(0, 200)
}

export type PullRequestReviewComment = {
  id?: string
  databaseId?: number
  author?: { login: string; name?: string }
  body: string
  createdAt: string
  submittedAt?: string
  url?: string
  state?: string
  path?: string
  line?: number | null
  originalLine?: number | null
  diffHunk?: string
}

export type PullRequestReviewThread = {
  id: string
  isResolved: boolean
  isOutdated: boolean
  viewerCanReply: boolean
  viewerCanResolve: boolean
  viewerCanUnresolve: boolean
  path: string
  line: number | null
  originalLine: number | null
  startLine?: number | null
  originalStartLine?: number | null
  diffSide?: 'LEFT' | 'RIGHT'
  comments: { nodes: PullRequestReviewComment[] }
}

export type ReviewDiffLine = {
  key: string
  content: string
  kind: 'header' | 'addition' | 'deletion' | 'context' | 'metadata'
  oldLine: number | null
  newLine: number | null
  highlighted: boolean
}

export function reviewThreadLine(thread: PullRequestReviewThread) {
  return thread.line ?? thread.originalLine
}

export function reviewThreadSide(thread: PullRequestReviewThread): 'LEFT' | 'RIGHT' {
  if (thread.diffSide) return thread.diffSide
  return thread.line === null ? 'LEFT' : 'RIGHT'
}

export function reviewThreadTarget(thread: PullRequestReviewThread) {
  const line = reviewThreadLine(thread)
  if (!thread.path || !line) return null
  return { path: thread.path, line, side: reviewThreadSide(thread) }
}

function hunkStart(line: string) {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  return match ? { oldLine: Number(match[1]), newLine: Number(match[2]) } : null
}

function lineKind(line: string): ReviewDiffLine['kind'] {
  if (line.startsWith('@@')) return 'header'
  if (line.startsWith('+')) return 'addition'
  if (line.startsWith('-')) return 'deletion'
  if (line.startsWith('\\')) return 'metadata'
  return 'context'
}

function lineNumbers(kind: ReviewDiffLine['kind'], oldLine: number, newLine: number) {
  if (kind === 'addition') return { oldLine: null, newLine }
  if (kind === 'deletion') return { oldLine, newLine: null }
  if (kind === 'context') return { oldLine, newLine }
  return { oldLine: null, newLine: null }
}

function advanceLines(kind: ReviewDiffLine['kind'], oldLine: number, newLine: number) {
  return {
    oldLine: oldLine + Number(kind === 'deletion' || kind === 'context'),
    newLine: newLine + Number(kind === 'addition' || kind === 'context'),
  }
}

function isTargetLine(side: 'LEFT' | 'RIGHT', target: number, oldLine: number | null, newLine: number | null) {
  return side === 'LEFT' ? oldLine === target : newLine === target
}

export function reviewThreadDiffLines(thread: PullRequestReviewThread): ReviewDiffLine[] {
  const diffHunk = thread.comments.nodes.find((comment) => comment.diffHunk)?.diffHunk
  const target = reviewThreadLine(thread)
  if (!diffHunk || !target) return []
  const side = reviewThreadSide(thread)
  let oldLine = 0
  let newLine = 0
  return diffHunk.split(/\r?\n/).map((content, index) => {
    const start = hunkStart(content)
    if (start) {
      oldLine = start.oldLine
      newLine = start.newLine
    }
    const kind = lineKind(content)
    const numbers = lineNumbers(kind, oldLine, newLine)
    const line = {
      key: `${index}:${oldLine}:${newLine}`,
      content,
      kind,
      ...numbers,
      highlighted: isTargetLine(side, target, numbers.oldLine, numbers.newLine),
    }
    const next = advanceLines(kind, oldLine, newLine)
    oldLine = next.oldLine
    newLine = next.newLine
    return line
  })
}

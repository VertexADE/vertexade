export type ReviewSuggestionTarget = {
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
}

function diffPath(header: string) {
  const value = header.slice(4).split('\t', 1)[0] || ''
  if (value === '/dev/null') return null
  return value.replace(/^[ab]\//, '')
}

function targetKey(target: ReviewSuggestionTarget) {
  return `${target.side}\0${target.line}\0${target.path}`
}

export type DiffLineIndex = ReadonlyMap<string, string>

type DiffParseState = {
  oldPath: string | null
  newPath: string | null
  oldLine: number | null
  newLine: number | null
}

function emptyDiffState(): DiffParseState {
  return { oldPath: null, newPath: null, oldLine: null, newLine: null }
}

function updateDiffMetadata(state: DiffParseState, rawLine: string) {
  if (rawLine.startsWith('diff --git ')) Object.assign(state, emptyDiffState())
  else if (rawLine.startsWith('--- ')) state.oldPath = diffPath(rawLine)
  else if (rawLine.startsWith('+++ ')) state.newPath = diffPath(rawLine)
  else {
    const hunk = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (!hunk) return false
    state.oldLine = Number(hunk[1])
    state.newLine = Number(hunk[2])
  }
  return true
}

function indexContextLine(index: Map<string, string>, state: DiffParseState, content: string) {
  if (state.oldPath) index.set(targetKey({ path: state.oldPath, line: state.oldLine!, side: 'LEFT' }), content)
  if (state.newPath) index.set(targetKey({ path: state.newPath, line: state.newLine!, side: 'RIGHT' }), content)
  state.oldLine! += 1
  state.newLine! += 1
}

function indexDeletion(index: Map<string, string>, state: DiffParseState, content: string) {
  if (state.oldPath) index.set(targetKey({ path: state.oldPath, line: state.oldLine!, side: 'LEFT' }), content)
  state.oldLine! += 1
}

function indexAddition(index: Map<string, string>, state: DiffParseState, content: string) {
  if (state.newPath) index.set(targetKey({ path: state.newPath, line: state.newLine!, side: 'RIGHT' }), content)
  state.newLine! += 1
}

function indexContentLine(index: Map<string, string>, state: DiffParseState, rawLine: string) {
  if (state.oldLine === null || state.newLine === null || rawLine.startsWith('\\ No newline')) return
  const content = rawLine.slice(1)
  if (rawLine[0] === ' ') indexContextLine(index, state, content)
  else if (rawLine[0] === '-') indexDeletion(index, state, content)
  else if (rawLine[0] === '+') indexAddition(index, state, content)
}

/** Indexes every commentable line in a unified diff for repeated, exact target lookups. */
export function createDiffLineIndex(diff: string): DiffLineIndex {
  const index = new Map<string, string>()
  const state = emptyDiffState()
  for (const rawLine of String(diff || '').split(/\r?\n/)) {
    if (!updateDiffMetadata(state, rawLine)) indexContentLine(index, state, rawLine)
  }

  return index
}

export function indexedDiffLineContent(index: DiffLineIndex, target: ReviewSuggestionTarget): string | null {
  const key = targetKey(target)
  return index.has(key) ? index.get(key)! : null
}

/** Returns the exact source text at a unified-diff target, or null when the target is not part of the patch. */
export function diffLineContent(diff: string, target: ReviewSuggestionTarget): string | null {
  return indexedDiffLineContent(createDiffLineIndex(diff), target)
}

function longestBacktickRun(value: string) {
  return Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length))
}

/** Formats a GitHub-compatible suggested-change comment without allowing replacement code to close its fence. */
export function suggestionMarkdown(description: string, replacement: string) {
  const normalized = String(replacement).replace(/\r\n/g, '\n')
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(normalized) + 1))
  const explanation = String(description).trim()
  return `${explanation ? `${explanation}\n\n` : ''}${fence}suggestion\n${normalized}\n${fence}`
}

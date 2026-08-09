export type DiffFileSummary = {
  path: string
  additions: number
  deletions: number
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  binary: boolean
}

export type DiffSummary = {
  files: DiffFileSummary[]
  additions: number
  deletions: number
}

export function summarizeDiff(diff: unknown): DiffSummary {
  const files: DiffFileSummary[] = []
  let current: DiffFileSummary | null = null
  for (const line of String(diff || '').split(/\r?\n/)) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/)
    if (match) {
      current = { path: match[2]!, additions: 0, deletions: 0, status: 'modified', binary: false }
      files.push(current)
    } else if (current && line.startsWith('new file mode ')) current.status = 'added'
    else if (current && line.startsWith('deleted file mode ')) current.status = 'deleted'
    else if (current && line.startsWith('rename to ')) {
      current.status = 'renamed'
      current.path = line.slice('rename to '.length)
    } else if (current && line.startsWith('Binary files ')) current.binary = true
    else if (current && line.startsWith('+') && !line.startsWith('+++')) current.additions += 1
    else if (current && line.startsWith('-') && !line.startsWith('---')) current.deletions += 1
  }
  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  }
}

function diffChunks(diff: string) {
  const starts = [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)]
  return starts.map((match, index) => ({
    path: match[2]!,
    content: diff.slice(match.index, starts[index + 1]?.index ?? diff.length),
  }))
}

export function createDiffPreview(diff: unknown, maximumBytes = 2_000_000, maximumFileBytes = 500_000) {
  const source = String(diff || '')
  const originalBytes = Buffer.byteLength(source)
  if (originalBytes <= maximumBytes) {
    return {
      diff: source,
      diff_summary: summarizeDiff(source),
      truncated: false,
      omitted_files: [] as string[],
      original_bytes: originalBytes,
    }
  }

  const selected: string[] = []
  const omittedFiles: string[] = []
  let selectedBytes = 0
  for (const chunk of diffChunks(source)) {
    const bytes = Buffer.byteLength(chunk.content)
    if (bytes > maximumFileBytes || selectedBytes + bytes > maximumBytes) {
      omittedFiles.push(chunk.path)
      continue
    }
    selected.push(chunk.content)
    selectedBytes += bytes
  }
  const preview = selected.join('')
  return {
    diff: preview,
    diff_summary: summarizeDiff(preview),
    truncated: true,
    omitted_files: omittedFiles,
    original_bytes: originalBytes,
  }
}

export function storedDiffSummary(value: { diff_files?: unknown; diff_additions?: unknown; diff_deletions?: unknown }): DiffSummary {
  let files: DiffFileSummary[] = []
  try {
    const parsed = JSON.parse(String(value.diff_files || '[]'))
    if (Array.isArray(parsed)) files = parsed
  } catch {}
  return {
    files,
    additions: Number(value.diff_additions || 0),
    deletions: Number(value.diff_deletions || 0),
  }
}

import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

const REQUIRED_DETAIL_HEADINGS = ['Findings', 'Intended outcome', 'Quality scorecard', 'Recommendation', 'Validation']

export function isCompleteDetailedReview(value: unknown): boolean {
  const markdown = String(value || '')
  return REQUIRED_DETAIL_HEADINGS.every((heading) => new RegExp(`^##\\s+${heading}\\s*$`, 'im').test(markdown))
}

function referencedReportPaths(markdown: string): string[] {
  const quoted = [...markdown.matchAll(/`([^`\r\n]+\.(?:md|txt))`/gi)].map((match) => match[1])
  const bare = markdown.match(/(?:^|\s)(\/[^\s`'"<>]+\.(?:md|txt))(?=$|\s)/g)?.map((match) => match.trim()) || []
  return [...new Set([...quoted, ...bare])]
}

export async function resolveDetailedReviewOutput(resultText: unknown, worktreePath: string): Promise<string> {
  const result = String(resultText || '').trim()
  if (isCompleteDetailedReview(result)) return result
  let root: string
  try {
    root = await realpath(worktreePath)
  } catch {
    return result
  }
  let best = result
  for (const reference of referencedReportPaths(result)) {
    try {
      const candidate = await realpath(resolve(root, reference))
      if (!candidate.startsWith(`${root}${sep}`)) continue
      const info = await stat(candidate)
      if (!info.isFile() || info.size > 2 * 1024 * 1024) continue
      const content = (await readFile(candidate, 'utf8')).trim()
      if (isCompleteDetailedReview(content) && content.length > best.length) best = content
    } catch {}
  }
  return best
}

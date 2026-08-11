import { lazy } from 'react'

import { LazyBoundary } from '@vertexade/ui/components/lazy-boundary'
import { MarkdownRenderer, type MarkdownContentProps } from '@vertexade/ui/components/markdown-renderer'
import { hasMarkdownMath } from '@vertexade/ui/lib/markdown-profile'

export type { FileReference, MarkdownContentProps } from '@vertexade/ui/components/markdown-renderer'

const LazyMarkdownMathContent = lazy(() =>
  import('@vertexade/ui/components/markdown-math-content').then(({ MarkdownMathContent }) => ({
    default: MarkdownMathContent,
  })),
)

function spaces(value: string) {
  return value.replace(/[^\n]/g, ' ')
}

function maskInlineCode(line: string) {
  let result = line
  let cursor = 0
  while (cursor < line.length) {
    const opening = line.indexOf('`', cursor)
    if (opening < 0) break
    let width = 1
    while (line[opening + width] === '`') width += 1
    const delimiter = '`'.repeat(width)
    const closing = line.indexOf(delimiter, opening + width)
    if (closing < 0) break
    const end = closing + width
    result = `${result.slice(0, opening)}${' '.repeat(end - opening)}${result.slice(end)}`
    cursor = end
  }
  return result
}

function markdownText(content: string) {
  let fence: { marker: '`' | '~'; width: number } | null = null
  return content
    .split(/(?<=\n)/)
    .map((line) => {
      if (fence) {
        const closing = line.match(/^ {0,3}(`+|~+)\s*$/)
        if (closing?.[1][0] === fence.marker && closing[1].length >= fence.width) fence = null
        return spaces(line)
      }
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/)
      if (opening) {
        fence = { marker: opening[1][0] as '`' | '~', width: opening[1].length }
        return spaces(line)
      }
      if (/^(?: {4}|\t)/.test(line)) return spaces(line)
      return maskInlineCode(line)
    })
    .join('')
}

export function containsMarkdownMath(content: string) {
  return hasMarkdownMath(markdownText(content))
}

export function MarkdownContent(props: MarkdownContentProps) {
  if (!containsMarkdownMath(props.content)) return <MarkdownRenderer {...props} />
  return (
    <LazyBoundary label="mathematical notation" fallback={<MarkdownRenderer {...props} />} resetKey={props.content}>
      <LazyMarkdownMathContent {...props} />
    </LazyBoundary>
  )
}

import { lazy } from 'react'

import { LazyBoundary } from '@vertexade/ui/components/lazy-boundary'
import { MarkdownRenderer, type MarkdownContentProps } from '@vertexade/ui/components/markdown-renderer'

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

function escapedAt(content: string, index: number) {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && content[cursor] === '\\'; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function containsBackslashMath(content: string, opening: '\\(' | '\\[', closing: '\\)' | '\\]') {
  let cursor = 0
  while (cursor < content.length) {
    const start = content.indexOf(opening, cursor)
    if (start < 0) return false
    if (!escapedAt(content, start)) {
      const end = content.indexOf(closing, start + opening.length)
      if (end >= 0 && content.slice(start + opening.length, end).trim()) return true
    }
    cursor = start + opening.length
  }
  return false
}

function dollarDelimiter(content: string, start: number) {
  if (content[start] !== '$' || escapedAt(content, start)) return null
  const block = content[start + 1] === '$'
  const delimiter = block ? '$$' : '$'
  const expressionStart = start + delimiter.length
  if (!block && (content[expressionStart] === '$' || /\s/.test(content[expressionStart] || ''))) return null
  return { block, delimiter, expressionStart }
}

function closingDollar(content: string, delimiter: string, expressionStart: number) {
  let end = expressionStart
  while ((end = content.indexOf(delimiter, end)) >= 0) {
    if (!escapedAt(content, end)) return end
    end += delimiter.length
  }
  return -1
}

function validDollarExpression(content: string, start: number, end: number, block: boolean) {
  const expression = content.slice(start, end)
  if (!expression.trim()) return false
  if (block) return true
  if (expression.includes('\n') || /\s$/.test(expression) || expression.endsWith('\\')) return false
  const currencyRange = /^[\d.,]+[-–—]$/.test(expression) && /\d/.test(content[end + 1] || '')
  return !currencyRange
}

function containsDollarMath(content: string) {
  for (let start = 0; start < content.length; start += 1) {
    const candidate = dollarDelimiter(content, start)
    if (!candidate) continue
    const end = closingDollar(content, candidate.delimiter, candidate.expressionStart)
    if (end >= 0 && validDollarExpression(content, candidate.expressionStart, end, candidate.block)) return true
  }
  return false
}

export function containsMarkdownMath(content: string) {
  const text = markdownText(content)
  return containsDollarMath(text) || containsBackslashMath(text, '\\(', '\\)') || containsBackslashMath(text, '\\[', '\\]')
}

export function MarkdownContent(props: MarkdownContentProps) {
  if (!containsMarkdownMath(props.content)) return <MarkdownRenderer {...props} />
  return (
    <LazyBoundary label="mathematical notation" fallback={<MarkdownRenderer {...props} />} resetKey={props.content}>
      <LazyMarkdownMathContent {...props} />
    </LazyBoundary>
  )
}

import { nameToEmoji } from 'gemoji'
import { calloutsExtension } from '@tanstack/markdown/extensions/callouts'
import { streamingMarkdownExtension } from '@tanstack/markdown/extensions/streaming'
import type { InlineNode, MarkdownExtension } from '@tanstack/markdown'
import type { ScmReferencePresentation } from '@vertexade/platform-contracts'

const sourceExtensions =
  'ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|vue|svelte|css|scss|html|json|yaml|yml|toml|md|sql|sh|graphql|proto'
const inlineReference = new RegExp(`^((?:[\\w@.-]+/)*[\\w@.-]+\\.(?:${sourceExtensions})):(\\d+)(?:-\\d+)?$`, 'i')
const textReferences = new RegExp(`(?<![\\w:/.-])((?:[\\w@.-]+/)*[\\w@.-]+\\.(?:${sourceExtensions})):(\\d+)(?:-\\d+)?`, 'gi')
const scmReference = /(^|[^\w])(@[a-z\d](?:[a-z\d-]{0,38})(?:\/[a-z\d](?:[a-z\d-]{0,38}))?|#\d+)\b/gi
const gemojiReference = /:([+\-\w]+):/g
const mathPrefix = 'vertexade-math:'

export type ParsedMarkdownMath = {
  display: boolean
  expression: string
}

export type MarkdownProfileOptions = {
  referencePresentation?: ScmReferencePresentation
  streaming?: boolean
}

type MathToken = ParsedMarkdownMath & {
  start: number
  end: number
}

type InlineReplacement = {
  start: number
  end: number
  node: InlineNode
}

function referenceUrl(path: string, line: number): string {
  return `worktree://file?path=${encodeURIComponent(path)}&line=${line}`
}

function fillTemplate(template: string | undefined, values: Record<string, string>): string | undefined {
  if (!template) return undefined
  return Object.entries(values).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, encodeURIComponent(replacement)),
    template,
  )
}

function replaceTextNodes(nodes: InlineNode[], replace: (value: string) => InlineNode[]): InlineNode[] {
  return nodes.flatMap((node) => (node.type === 'text' ? replace(node.value) : node))
}

function replaceMatchedText(
  value: string,
  matches: IterableIterator<RegExpMatchArray>,
  replacement: (match: RegExpMatchArray) => InlineReplacement | null,
): InlineNode[] {
  const nodes: InlineNode[] = []
  let cursor = 0
  for (const match of matches) {
    const result = replacement(match)
    if (!result) continue
    if (result.start > cursor) nodes.push({ type: 'text', value: value.slice(cursor, result.start) })
    nodes.push(result.node)
    cursor = result.end
  }
  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
  return nodes.length ? nodes : [{ type: 'text', value }]
}

function linkedFileReferences(value: string): InlineNode[] {
  return replaceMatchedText(value, value.matchAll(textReferences), (match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    node: {
      type: 'link',
      href: referenceUrl(match[1], Number(match[2])),
      children: [{ type: 'text', value: match[0] }],
    },
  }))
}

function scmUrl(reference: string, presentation: ScmReferencePresentation): string | undefined {
  if (reference.startsWith('#')) return fillTemplate(presentation.issueUrlTemplate, { number: reference.slice(1) })
  if (reference.includes('/')) {
    const [organization, team] = reference.slice(1).split('/')
    return fillTemplate(presentation.teamUrlTemplate, { organization, team })
  }
  return fillTemplate(presentation.userUrlTemplate, { user: reference.slice(1) })
}

function linkedScmReferences(value: string, presentation: ScmReferencePresentation): InlineNode[] {
  return replaceMatchedText(value, value.matchAll(scmReference), (match) => {
    const prefixLength = match[1].length
    const index = (match.index ?? 0) + prefixLength
    const reference = match[2]
    const href = scmUrl(reference, presentation)
    return {
      start: index,
      end: index + reference.length,
      node: href ? { type: 'link', href, children: [{ type: 'text', value: reference }] } : { type: 'text', value: reference },
    }
  })
}

function expandedGemoji(value: string): InlineNode[] {
  return replaceMatchedText(value, value.matchAll(gemojiReference), (match) => {
    const emoji = nameToEmoji[match[1]]
    if (!emoji) return null
    const index = match.index ?? 0
    return { start: index, end: index + match[0].length, node: { type: 'text', value: emoji } }
  })
}

function hardBreaks(value: string): InlineNode[] {
  const lines = value.split('\n')
  if (lines.length === 1) return [{ type: 'text', value }]
  return lines.flatMap((line, index) =>
    index ? [{ type: 'break' as const }, { type: 'text' as const, value: line }] : [{ type: 'text', value: line }],
  )
}

function escapedAt(content: string, index: number): boolean {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && content[cursor] === '\\'; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function validDollarExpression(content: string, start: number, end: number, display: boolean): boolean {
  const expression = content.slice(start, end)
  if (!expression.trim()) return false
  if (display) return true
  if (expression.includes('\n') || /\s$/.test(expression) || expression.endsWith('\\')) return false
  const currencyRange = /^[\d.,]+[-–—]$/.test(expression) && /\d/.test(content[end + 1] || '')
  return !currencyRange
}

type DollarDelimiter = {
  delimiter: '$' | '$$'
  display: boolean
  expressionStart: number
}

function dollarDelimiter(content: string, start: number): DollarDelimiter | null {
  if (content[start] !== '$' || escapedAt(content, start)) return null
  const display = content[start + 1] === '$'
  const delimiter = display ? '$$' : '$'
  const expressionStart = start + delimiter.length
  if (!display && (content[expressionStart] === '$' || /\s/.test(content[expressionStart] || ''))) return null
  return { delimiter, display, expressionStart }
}

function dollarMath(content: string, start: number): MathToken | null {
  const candidate = dollarDelimiter(content, start)
  if (!candidate) return null
  const { delimiter, display, expressionStart } = candidate
  let closing = expressionStart
  while ((closing = content.indexOf(delimiter, closing)) >= 0) {
    if (!escapedAt(content, closing) && validDollarExpression(content, expressionStart, closing, display)) {
      return {
        start,
        end: closing + delimiter.length,
        display,
        expression: content.slice(expressionStart, closing),
      }
    }
    closing += delimiter.length
  }
  return null
}

function backslashMath(content: string, start: number): MathToken | null {
  const opening = content.slice(start, start + 2)
  if (!['\\(', '\\['].includes(opening) || escapedAt(content, start)) return null
  const closingDelimiter = opening === '\\(' ? '\\)' : '\\]'
  const closing = content.indexOf(closingDelimiter, start + 2)
  if (closing < 0 || !content.slice(start + 2, closing).trim()) return null
  return {
    start,
    end: closing + 2,
    display: opening === '\\[',
    expression: content.slice(start + 2, closing),
  }
}

function nextMath(content: string, offset: number): MathToken | null {
  for (let index = offset; index < content.length; index += 1) {
    const token = content[index] === '$' ? dollarMath(content, index) : content[index] === '\\' ? backslashMath(content, index) : null
    if (token) return token
  }
  return null
}

export function hasMarkdownMath(value: string): boolean {
  return nextMath(value, 0) !== null
}

function markedMath(value: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let cursor = 0
  let token = nextMath(value, cursor)
  while (token) {
    if (token.start > cursor) nodes.push({ type: 'text', value: value.slice(cursor, token.start) })
    nodes.push({
      type: 'inlineCode',
      value: `${mathPrefix}${token.display ? 'display' : 'inline'}:${token.expression}`,
    })
    cursor = token.end
    token = nextMath(value, cursor)
  }
  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
  return nodes.length ? nodes : [{ type: 'text', value }]
}

function vertexadeMarkdownExtension(referencePresentation?: ScmReferencePresentation): MarkdownExtension {
  return {
    name: 'vertexade-content-profile',
    transformInline(nodes) {
      let transformed = replaceTextNodes(nodes, linkedFileReferences)
      if (referencePresentation) transformed = replaceTextNodes(transformed, (value) => linkedScmReferences(value, referencePresentation))
      transformed = replaceTextNodes(transformed, markedMath)
      transformed = replaceTextNodes(transformed, expandedGemoji)
      return replaceTextNodes(transformed, hardBreaks)
    },
  }
}

export function markdownProfileExtensions(options: MarkdownProfileOptions = {}): MarkdownExtension[] {
  return [
    calloutsExtension(),
    vertexadeMarkdownExtension(options.referencePresentation),
    ...(options.streaming ? [streamingMarkdownExtension()] : []),
  ]
}

export function parseMarkdownMath(value: string): ParsedMarkdownMath | null {
  if (!value.startsWith(mathPrefix)) return null
  const markerEnd = value.indexOf(':', mathPrefix.length)
  if (markerEnd < 0) return null
  const mode = value.slice(mathPrefix.length, markerEnd)
  if (!['inline', 'display'].includes(mode)) return null
  return { display: mode === 'display', expression: value.slice(markerEnd + 1) }
}

export function parseInlineFileReference(value: string): { path: string; line: number } | null {
  const match = value.match(inlineReference)
  return match ? { path: match[1], line: Number(match[2]) } : null
}

export function parseMarkdownFileHref(href: string | undefined, worktreePath?: string): { path: string; line: number } | null {
  if (!href) return null
  if (href.startsWith('worktree://file?')) {
    const url = new URL(href)
    const path = url.searchParams.get('path')
    const line = Number(url.searchParams.get('line'))
    return path ? { path, line: Number.isInteger(line) && line > 0 ? line : 1 } : null
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return null
  let decoded = decodeURIComponent(href)
  const root = worktreePath?.replace(/\/$/, '')
  if (root && decoded.startsWith(`${root}/`)) decoded = decoded.slice(root.length + 1)
  else if (decoded.startsWith('/')) return null
  const match = decoded.match(new RegExp(`^((?:[\\w@.-]+/)*[\\w@.-]+\\.(?:${sourceExtensions}))(?::(\\d+)|#L(\\d+))?$`, 'i'))
  return match ? { path: match[1], line: Number(match[2] || match[3] || 1) } : null
}

export function resolveMarkdownUrl(href: string | undefined, base?: string): string | undefined {
  if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href)) return href
  try {
    return base ? new URL(href, base).href : href
  } catch {
    return href
  }
}

import { isValidElement, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Options as ReactMarkdownOptions } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import remarkBreaks from 'remark-breaks'
import remarkGemoji from 'remark-gemoji'
import remarkGfm from 'remark-gfm'
import type { Root } from 'mdast'
import type { Plugin } from 'unified'
import type { ScmReferencePresentation } from '@vertexade/platform-contracts'

import { MermaidDiagram } from '@vertexade/ui/components/mermaid-diagram'
import { cn } from '@vertexade/ui/lib/utils'

export type FileReference = { path: string; line: number }
export type MarkdownContentProps = {
  content: string
  onOpenFile?: (reference: FileReference) => void
  worktreePath?: string
  linkBaseUrl?: string
  referencePresentation?: ScmReferencePresentation
  className?: string
}
type MarkdownEnhancements = Pick<ReactMarkdownOptions, 'remarkPlugins' | 'rehypePlugins'>
type MarkdownNode = {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
  data?: { hProperties?: Record<string, unknown> }
}

const sourceExtensions =
  'ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|vue|svelte|css|scss|html|json|yaml|yml|toml|md|sql|sh|graphql|proto'
const inlineReference = new RegExp(`^((?:[\\w@.-]+/)*[\\w@.-]+\\.(?:${sourceExtensions})):(\\d+)(?:-\\d+)?$`, 'i')
const textReferences = new RegExp(`(?<![\\w:/.-])((?:[\\w@.-]+/)*[\\w@.-]+\\.(?:${sourceExtensions})):(\\d+)(?:-\\d+)?`, 'gi')
const alertTypes = new Set(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])

function referenceUrl(path: string, line: number) {
  return `worktree://file?path=${encodeURIComponent(path)}&line=${line}`
}

function linkText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = []
  let cursor = 0
  for (const match of value.matchAll(textReferences)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push({ type: 'text', value: value.slice(cursor, index) })
    nodes.push({
      type: 'link',
      url: referenceUrl(match[1], Number(match[2])),
      children: [{ type: 'text', value: match[0] }],
    })
    cursor = index + match[0].length
  }
  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
  return nodes.length ? nodes : [{ type: 'text', value }]
}

const remarkGithubEnhancements: Plugin<[], Root> = () => (tree) => {
  function transform(node: MarkdownNode) {
    if (node.type === 'blockquote') {
      const first = node.children?.[0]?.children?.[0]
      const match = first?.type === 'text' ? first.value?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i) : null
      if (match && first?.value) {
        const type = match[1].toUpperCase()
        first.value = first.value.slice(match[0].length)
        node.data = {
          ...node.data,
          hProperties: {
            className: `markdown-alert markdown-alert-${type.toLowerCase()}`,
            'data-alert': type,
          },
        }
      }
    }
    if (!node.children || ['link', 'linkReference', 'code', 'inlineCode'].includes(node.type)) return
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text' && child.value) return linkText(child.value)
      transform(child)
      return child
    })
  }
  transform(tree as MarkdownNode)
}

function fillTemplate(template: string | undefined, values: Record<string, string>) {
  if (!template) return undefined
  return Object.entries(values).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, encodeURIComponent(replacement)),
    template,
  )
}

const remarkScmReferences: Plugin<[{ presentation?: ScmReferencePresentation }?], Root> = (options) => (tree) => {
  const presentation = options?.presentation
  if (!presentation) return
  const links = presentation
  function linked(value: string): MarkdownNode[] {
    const pattern = /(^|[^\w])(@[a-z\d](?:[a-z\d-]{0,38})(?:\/[a-z\d](?:[a-z\d-]{0,38}))?|#\d+)\b/gi
    const nodes: MarkdownNode[] = []
    let cursor = 0
    for (const match of value.matchAll(pattern)) {
      const prefixLength = match[1].length
      const index = (match.index || 0) + prefixLength
      if (index > cursor) nodes.push({ type: 'text', value: value.slice(cursor, index) })
      const reference = match[2]
      let url: string | undefined
      if (reference.startsWith('#')) url = fillTemplate(links.issueUrlTemplate, { number: reference.slice(1) })
      else if (reference.includes('/')) {
        const [org, team] = reference.slice(1).split('/')
        url = fillTemplate(links.teamUrlTemplate, { organization: org, team })
      } else if (reference.startsWith('@')) url = fillTemplate(links.userUrlTemplate, { user: reference.slice(1) })
      nodes.push(url ? { type: 'link', url, children: [{ type: 'text', value: reference }] } : { type: 'text', value: reference })
      cursor = index + reference.length
    }
    if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
    return nodes.length ? nodes : [{ type: 'text', value }]
  }
  function transform(node: MarkdownNode) {
    if (!node.children || ['link', 'linkReference', 'code', 'inlineCode'].includes(node.type)) return
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text' && child.value) return linked(child.value)
      transform(child)
      return child
    })
  }
  transform(tree as MarkdownNode)
}

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'id', 'title'],
    a: [...(defaultSchema.attributes?.a || []), 'name', 'target', 'rel'],
    blockquote: [...(defaultSchema.attributes?.blockquote || []), 'dataAlert'],
    input: [...(defaultSchema.attributes?.input || []), 'checked', 'disabled', 'type'],
    details: ['open'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href || []), 'worktree'],
  },
}

function parseFileHref(href: string | undefined, worktreePath?: string): FileReference | null {
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

function resolveUrl(href: string | undefined, base?: string) {
  if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href)) return href
  try {
    return base ? new URL(href, base).href : href
  } catch {
    return href
  }
}

function heading(Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6', classes: string) {
  return function Heading({ id, children }: { id?: string; children?: ReactNode }) {
    return (
      <Tag id={id} className={cn('group scroll-mt-4', classes)}>
        {id && (
          <a
            href={`#${id}`}
            aria-label="Link to section"
            className="mr-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          >
            #
          </a>
        )}
        {children}
      </Tag>
    )
  }
}

export function MarkdownRenderer({
  content,
  onOpenFile,
  worktreePath,
  linkBaseUrl,
  referencePresentation,
  className,
  enhancements = {},
}: MarkdownContentProps & { enhancements?: MarkdownEnhancements }) {
  return (
    <div className={cn('markdown-body min-w-0 text-sm leading-relaxed text-foreground/90', className)}>
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          remarkBreaks,
          remarkGemoji,
          ...(enhancements.remarkPlugins || []),
          remarkGithubEnhancements,
          [remarkScmReferences, { presentation: referencePresentation }],
        ]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], ...(enhancements.rehypePlugins || []), rehypeSlug]}
        urlTransform={(url) => (url.startsWith('worktree://') ? url : defaultUrlTransform(url))}
        components={{
          h1: heading('h1', 'mb-3 mt-6 border-b pb-2 text-2xl font-semibold first:mt-0'),
          h2: heading('h2', 'mb-2 mt-6 border-b pb-1.5 text-xl font-semibold first:mt-0'),
          h3: heading('h3', 'mb-2 mt-5 text-lg font-semibold'),
          h4: heading('h4', 'mb-2 mt-4 text-base font-semibold'),
          h5: heading('h5', 'mb-2 mt-4 text-sm font-semibold'),
          h6: heading('h6', 'mb-2 mt-4 text-sm font-semibold text-muted-foreground'),
          p: ({ children }) => <p className="my-2">{children}</p>,
          ul: ({ children, className: listClass }) => <ul className={cn('my-2 list-disc space-y-1 pl-6', listClass)}>{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>,
          li: ({ children, className: itemClass }) => <li className={cn('pl-0.5 [&>p]:my-0', itemClass)}>{children}</li>,
          input: (props) => <input {...props} disabled className="mr-1.5 translate-y-px accent-blue-500" />,
          blockquote: ({ children, className: quoteClass, ...props }) => {
            const alert = String((props as Record<string, unknown>)['data-alert'] || '')
            return (
              <blockquote
                className={cn(
                  'my-3 border-l-4 border-border bg-muted/20 px-3 py-1 text-muted-foreground [&>p]:my-1',
                  quoteClass,
                  alert === 'NOTE' && 'border-blue-500 bg-blue-500/5',
                  alert === 'TIP' && 'border-emerald-500 bg-emerald-500/5',
                  alert === 'IMPORTANT' && 'border-violet-500 bg-violet-500/5',
                  alert === 'WARNING' && 'border-amber-500 bg-amber-500/5',
                  alert === 'CAUTION' && 'border-red-500 bg-red-500/5',
                )}
                {...props}
              >
                {alert && <strong className="block text-xs uppercase tracking-wide text-foreground">{alert}</strong>}
                {children}
              </blockquote>
            )
          },
          hr: () => <hr className="my-5 border-border" />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto overscroll-x-contain rounded-md border [scrollbar-width:thin]">
              <table className="w-full min-w-[36rem] border-collapse text-xs sm:min-w-0">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-r bg-muted/50 px-3 py-2 text-left font-semibold last:border-r-0">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-r px-3 py-2 align-top last:border-r-0">{children}</td>,
          pre: ({ children }) =>
            isValidElement<{ className?: string }>(children) && children.props.className === 'language-mermaid' ? (
              children
            ) : (
              <pre className="my-3 overflow-x-auto rounded-md border bg-black/40 p-3 font-mono text-xs leading-relaxed">{children}</pre>
            ),
          code: ({ children, className: codeClassName }) => {
            const raw = String(children).replace(/\n$/, '')
            if (codeClassName === 'language-mermaid') return <MermaidDiagram chart={raw} />
            const value = raw.trim()
            const reference = !raw.includes('\n') ? value.match(inlineReference) : null
            if (reference && onOpenFile)
              return (
                <button
                  type="button"
                  onClick={() => onOpenFile({ path: reference[1], line: Number(reference[2]) })}
                  className="rounded bg-blue-500/10 px-1 py-0.5 font-mono text-[.9em] text-blue-400 hover:bg-blue-500/20 hover:underline"
                >
                  {value}
                </button>
              )
            const color =
              !raw.includes('\n') && (/^#[\da-f]{6}$/i.test(value) || /^rgb\(/i.test(value) || /^hsl\(/i.test(value)) ? value : null
            return (
              <code
                className={cn(
                  raw.includes('\n') ? 'bg-transparent p-0' : 'rounded bg-muted px-1 py-0.5',
                  'font-mono text-[.9em]',
                  codeClassName,
                )}
              >
                {color && (
                  <span className="mr-1 inline-block size-2.5 rounded-full border align-middle" style={{ backgroundColor: color }} />
                )}
                {children}
              </code>
            )
          },
          details: ({ children, ...props }) => (
            <details {...props} className="my-3 rounded-md border bg-muted/10 px-3 py-2">
              {children}
            </details>
          ),
          summary: ({ children }) => <summary className="cursor-pointer font-semibold">{children}</summary>,
          kbd: ({ children }) => <kbd className="rounded border border-b-2 bg-muted px-1.5 py-0.5 font-mono text-[.8em]">{children}</kbd>,
          img: ({ src, alt, ...props }) => (
            <img
              src={resolveUrl(src, linkBaseUrl)}
              alt={alt || ''}
              loading="lazy"
              className="my-3 h-auto max-w-full rounded-md"
              {...props}
            />
          ),
          a: ({ href, children, ...props }: ComponentPropsWithoutRef<'a'>) => {
            const reference = parseFileHref(href, worktreePath)
            if (reference && onOpenFile)
              return (
                <button
                  type="button"
                  onClick={() => onOpenFile(reference)}
                  className="font-mono text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:decoration-blue-400"
                >
                  {children}
                </button>
              )
            if (reference) return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[.9em]">{children}</code>
            const target = resolveUrl(href, linkBaseUrl)
            const external = target && !target.startsWith('#')
            return (
              <a
                href={target}
                target={external ? '_blank' : undefined}
                rel={external ? 'noreferrer' : undefined}
                className="text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:decoration-blue-400"
                {...props}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

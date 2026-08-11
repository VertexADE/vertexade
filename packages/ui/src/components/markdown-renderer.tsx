import { Children, isValidElement, useMemo, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { Markdown, type MarkdownComponents } from '@tanstack/markdown/react'
import type { ScmReferencePresentation } from '@vertexade/platform-contracts'

import { MermaidDiagram } from '@vertexade/ui/components/mermaid-diagram'
import {
  markdownProfileExtensions,
  parseInlineFileReference,
  parseMarkdownFileHref,
  parseMarkdownMath,
  resolveMarkdownUrl,
  type ParsedMarkdownMath,
} from '@vertexade/ui/lib/markdown-profile'
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

export type MarkdownEnhancements = {
  renderMath?(expression: string, display: boolean): ReactNode
}

type MarkdownComponentOptions = Omit<MarkdownContentProps, 'content' | 'className' | 'referencePresentation'> & MarkdownEnhancements

function heading(Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6', classes: string) {
  return function Heading({ id, children }: { id?: string; children?: ReactNode }) {
    return (
      <Tag id={id} className={cn('group scroll-mt-4', classes)}>
        {id ? (
          <a
            href={`#${id}`}
            aria-label="Link to section"
            className="mr-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          >
            #
          </a>
        ) : null}
        {children}
      </Tag>
    )
  }
}

type MarkdownCodeProps = ComponentPropsWithoutRef<'code'> & Pick<MarkdownComponentOptions, 'onOpenFile' | 'renderMath'>

function MarkdownMathCode({ math, renderMath }: { math: ParsedMarkdownMath; renderMath: MarkdownComponentOptions['renderMath'] }) {
  if (renderMath) return renderMath(math.expression, math.display)
  const delimiter = math.display ? '$$' : '$'
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[.9em]">{`${delimiter}${math.expression}${delimiter}`}</code>
}

function markdownCodeColor(value: string): string | null {
  if (value.includes('\n')) return null
  const colorPattern = /^(?:#[\da-f]{6}|(?:rgb|hsl)\(.+\))$/i
  return colorPattern.test(value) ? value : null
}

function MarkdownColorSwatch({ raw }: { raw: string }) {
  const color = markdownCodeColor(raw.trim())
  if (!color) return null
  return <span className="mr-1 inline-block size-2.5 rounded-full border align-middle" style={{ backgroundColor: color }} />
}

function MarkdownLiteralCode({ children, className, onOpenFile, raw }: Omit<MarkdownCodeProps, 'renderMath'> & { raw: string }) {
  const value = raw.trim()
  const reference = !raw.includes('\n') ? parseInlineFileReference(value) : null
  if (reference && onOpenFile)
    return (
      <button
        type="button"
        onClick={() => onOpenFile(reference)}
        className="rounded bg-blue-500/10 px-1 py-0.5 font-mono text-[.9em] text-blue-400 hover:bg-blue-500/20 hover:underline"
      >
        {value}
      </button>
    )
  return (
    <code className={cn(raw.includes('\n') ? 'bg-transparent p-0' : 'rounded bg-muted px-1 py-0.5', 'font-mono text-[.9em]', className)}>
      <MarkdownColorSwatch raw={raw} />
      {children}
    </code>
  )
}

function MarkdownCode({ children, className, onOpenFile, renderMath }: MarkdownCodeProps) {
  const raw = String(children).replace(/\n$/, '')
  const math = parseMarkdownMath(raw)
  if (math) return <MarkdownMathCode math={math} renderMath={renderMath} />
  if (className === 'language-mermaid') return <MermaidDiagram chart={raw} />
  return (
    <MarkdownLiteralCode raw={raw} className={className} onOpenFile={onOpenFile}>
      {children}
    </MarkdownLiteralCode>
  )
}

function markdownComponents({ onOpenFile, worktreePath, linkBaseUrl, renderMath }: MarkdownComponentOptions): MarkdownComponents {
  const renderPre = ({ children }: ComponentPropsWithoutRef<'pre'>) => {
    const content = Children.toArray(children)
    if (content.length === 1 && isValidElement(content[0]) && content[0].type === MermaidDiagram) return content[0]
    return <pre className="my-3 overflow-x-auto rounded-md border bg-black/40 p-3 font-mono text-xs leading-relaxed">{children}</pre>
  }
  return {
    h1: heading('h1', 'mb-3 mt-6 border-b pb-2 text-2xl font-semibold first:mt-0'),
    h2: heading('h2', 'mb-2 mt-6 border-b pb-1.5 text-xl font-semibold first:mt-0'),
    h3: heading('h3', 'mb-2 mt-5 text-lg font-semibold'),
    h4: heading('h4', 'mb-2 mt-4 text-base font-semibold'),
    h5: heading('h5', 'mb-2 mt-4 text-sm font-semibold'),
    h6: heading('h6', 'mb-2 mt-4 text-sm font-semibold text-muted-foreground'),
    p: ({ children }) => <p className="my-2">{children}</p>,
    ul: ({ children, className }) => <ul className={cn('my-2 list-disc space-y-1 pl-6', className)}>{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>,
    li: ({ children, className }) => <li className={cn('pl-0.5 [&>p]:my-0', className)}>{children}</li>,
    input: (props) => <input {...props} disabled className="mr-1.5 translate-y-px accent-blue-500" />,
    blockquote: ({ children, className, ...props }) => (
      <blockquote
        className={cn('my-3 border-l-4 border-border bg-muted/20 px-3 py-1 text-muted-foreground [&>p]:my-1', className)}
        {...props}
      >
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-5 border-border" />,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto overscroll-x-contain rounded-md border [scrollbar-width:thin]">
        <table className="w-full min-w-[36rem] border-collapse text-xs sm:min-w-0">{children}</table>
      </div>
    ),
    th: ({ children, style }) => (
      <th style={style} className="border-b border-r bg-muted/50 px-3 py-2 text-left font-semibold last:border-r-0">
        {children}
      </th>
    ),
    td: ({ children, style }) => (
      <td style={style} className="border-b border-r px-3 py-2 align-top last:border-r-0">
        {children}
      </td>
    ),
    pre: renderPre,
    code: (props) => <MarkdownCode {...props} onOpenFile={onOpenFile} renderMath={renderMath} />,
    img: ({ src, alt, ...props }) => (
      <img
        src={resolveMarkdownUrl(typeof src === 'string' ? src : undefined, linkBaseUrl)}
        alt={alt || ''}
        loading="lazy"
        className="my-3 h-auto max-w-full rounded-md"
        {...props}
      />
    ),
    a: ({ href, children, ...props }) => {
      const reference = parseMarkdownFileHref(href, worktreePath)
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
      const target = resolveMarkdownUrl(href, linkBaseUrl)
      const external = Boolean(target && !target.startsWith('#'))
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
  const extensions = useMemo(() => markdownProfileExtensions({ referencePresentation }), [referencePresentation])
  const components = useMemo(
    () => markdownComponents({ onOpenFile, worktreePath, linkBaseUrl, renderMath: enhancements.renderMath }),
    [enhancements.renderMath, linkBaseUrl, onOpenFile, worktreePath],
  )
  return (
    <div
      data-markdown-renderer="tanstack-react"
      className={cn('markdown-body min-w-0 text-sm leading-relaxed text-foreground/90', className)}
    >
      <Markdown components={components} extensions={extensions} allowHtml={false} frontmatter={false} headingAnchors={false}>
        {content}
      </Markdown>
    </div>
  )
}

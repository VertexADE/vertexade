import 'katex/dist/katex.min.css'
import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import DOMPurify from 'dompurify'
import { Markdown as OctaneMarkdown, type MarkdownProps as OctaneMarkdownProps } from '@tanstack/markdown/octane'
import { createRoot, type Root } from 'octane'

import type { MarkdownContentProps } from '@vertexade/ui/components/markdown-renderer'
import {
  markdownProfileExtensions,
  parseInlineFileReference,
  parseMarkdownFileHref,
  parseMarkdownMath,
  resolveMarkdownUrl,
} from '@vertexade/ui/lib/markdown-profile'
import { cn } from '@vertexade/ui/lib/utils'

const threadMarkdownClasses =
  '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:border-b [&_h1]:pb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:border-b [&_h2]:pb-1.5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:mb-2 [&_h4]:mt-4 [&_h4]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_li]:pl-0.5 [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:bg-muted/20 [&_blockquote]:px-3 [&_blockquote]:py-1 [&_blockquote]:text-muted-foreground [&_hr]:my-5 [&_hr]:border-border [&_table]:my-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:rounded-md [&_table]:border [&_table]:text-xs [&_th]:border-b [&_th]:border-r [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border-b [&_td]:border-r [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-black/40 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[.9em] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:text-blue-400 [&_a]:underline [&_a]:underline-offset-2 [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md [&_.markdown-alert]:my-3 [&_.markdown-alert]:rounded-md [&_.markdown-alert]:border [&_.markdown-alert]:border-border [&_.markdown-alert]:bg-muted/20 [&_.markdown-alert]:px-3 [&_.markdown-alert]:py-2 [&_.markdown-alert-title]:font-semibold'

function eventElement(event: MouseEvent<HTMLDivElement>): Element | null {
  return event.target instanceof Element ? event.target : null
}

function inlineFileElement(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>('[data-file-reference]')
}

function anchorElement(element: Element): HTMLAnchorElement | null {
  return element.closest<HTMLAnchorElement>('a')
}

function handleThreadMarkdownClick(
  event: MouseEvent<HTMLDivElement>,
  worktreePath: string | undefined,
  onOpenFile: MarkdownContentProps['onOpenFile'],
): void {
  const target = eventElement(event)
  if (!target || !onOpenFile) return
  const inline = inlineFileElement(target)
  if (inline) {
    const path = inline.dataset.filePath
    const line = Number(inline.dataset.fileLine)
    if (path) {
      event.preventDefault()
      onOpenFile({ path, line: Number.isInteger(line) && line > 0 ? line : 1 })
    }
    return
  }
  const anchor = anchorElement(target)
  const reference = parseMarkdownFileHref(anchor?.getAttribute('href') ?? undefined, worktreePath)
  if (!reference) return
  event.preventDefault()
  onOpenFile(reference)
}

function handleThreadMarkdownKeyDown(event: KeyboardEvent<HTMLDivElement>, onOpenFile: MarkdownContentProps['onOpenFile']): void {
  if (!['Enter', ' '].includes(event.key) || !onOpenFile || !(event.target instanceof Element)) return
  const inline = inlineFileElement(event.target)
  const path = inline?.dataset.filePath
  const line = Number(inline?.dataset.fileLine)
  if (!path) return
  event.preventDefault()
  onOpenFile({ path, line: Number.isInteger(line) && line > 0 ? line : 1 })
}

function enhanceAnchor(anchor: HTMLAnchorElement, linkBaseUrl: string | undefined): void {
  const href = resolveMarkdownUrl(anchor.getAttribute('href') ?? undefined, linkBaseUrl)
  if (!href) return
  anchor.href = href
  if (href.startsWith('#') || href.startsWith('worktree://')) return
  anchor.target = '_blank'
  anchor.rel = 'noreferrer'
}

function enhanceImage(image: HTMLImageElement, linkBaseUrl: string | undefined): void {
  const source = resolveMarkdownUrl(image.getAttribute('src') ?? undefined, linkBaseUrl)
  if (source) image.src = source
  image.loading = 'lazy'
}

function enhanceLinks(host: HTMLElement, linkBaseUrl: string | undefined): void {
  for (const anchor of host.querySelectorAll<HTMLAnchorElement>('a')) enhanceAnchor(anchor, linkBaseUrl)
  for (const image of host.querySelectorAll<HTMLImageElement>('img')) enhanceImage(image, linkBaseUrl)
}

function enhanceInlineFiles(host: HTMLElement): void {
  for (const code of host.querySelectorAll<HTMLElement>('code:not(pre code)')) {
    const reference = parseInlineFileReference(code.textContent?.trim() ?? '')
    if (!reference) continue
    code.dataset.fileReference = 'true'
    code.dataset.filePath = reference.path
    code.dataset.fileLine = String(reference.line)
    code.tabIndex = 0
    code.setAttribute('role', 'button')
    code.classList.add('cursor-pointer', 'text-blue-400', 'hover:underline')
  }
}

async function enhanceMath(host: HTMLElement, active: () => boolean): Promise<void> {
  const formulas = Array.from(host.querySelectorAll<HTMLElement>('code')).flatMap((code) => {
    const parsed = parseMarkdownMath(code.textContent ?? '')
    return parsed ? [{ code, parsed }] : []
  })
  if (!formulas.length) return
  const { default: katex } = await import('katex')
  if (!active()) return
  for (const { code, parsed } of formulas) {
    if (!code.isConnected) continue
    code.innerHTML = katex.renderToString(parsed.expression, {
      displayMode: parsed.display,
      throwOnError: false,
      trust: false,
    })
    code.className = parsed.display ? 'my-3 block overflow-x-auto bg-transparent py-1 text-center' : 'bg-transparent p-0'
  }
}

async function enhanceMermaid(host: HTMLElement, active: () => boolean): Promise<void> {
  const diagrams = Array.from(host.querySelectorAll<HTMLElement>('pre code.language-mermaid'))
  if (!diagrams.length) return
  const [{ default: mermaid }] = await Promise.all([import('mermaid')])
  if (!active()) return
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', maxEdges: 10_000, suppressErrorRendering: true })
  await Promise.all(
    diagrams.map(async (code, index) => {
      try {
        const result = await mermaid.render(`thread-mermaid-${Date.now()}-${index}`, code.textContent ?? '')
        if (!active() || !code.isConnected) return
        const replacement = document.createElement('div')
        replacement.className = 'my-3 overflow-x-auto rounded-md border bg-white p-3 text-center [&_svg]:mx-auto [&_svg]:max-w-full'
        replacement.innerHTML = DOMPurify.sanitize(result.svg, {
          USE_PROFILES: { html: true, svg: true, svgFilters: true },
        })
        code.closest('pre')?.replaceWith(replacement)
      } catch {
        code.closest('pre')?.classList.add('border-red-500/40')
      }
    }),
  )
}

function enhanceThreadMarkdown(host: HTMLElement, linkBaseUrl: string | undefined, active: () => boolean): void {
  enhanceLinks(host, linkBaseUrl)
  enhanceInlineFiles(host)
  void enhanceMath(host, active)
  void enhanceMermaid(host, active)
}

export function ThreadMarkdownContent({
  content,
  onOpenFile,
  worktreePath,
  linkBaseUrl,
  referencePresentation,
  className,
}: MarkdownContentProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<Root | null>(null)
  const extensions = useMemo(() => markdownProfileExtensions({ referencePresentation, streaming: true }), [referencePresentation])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const root = createRoot(host, { identifierPrefix: 'thread-markdown-' })
    rootRef.current = root
    return () => {
      root.unmount()
      rootRef.current = null
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    const root = rootRef.current
    if (!host || !root) return
    let current = true
    const props: OctaneMarkdownProps = {
      children: content,
      extensions,
      allowHtml: false,
      frontmatter: false,
      headingIds: true,
      headingAnchors: false,
    }
    root.render(OctaneMarkdown, props)
    enhanceThreadMarkdown(host, linkBaseUrl, () => current)
    return () => {
      current = false
    }
  }, [content, extensions, linkBaseUrl])

  return (
    <div
      ref={hostRef}
      data-markdown-renderer="tanstack-octane"
      className={cn('markdown-body min-w-0 text-sm leading-relaxed text-foreground/90', threadMarkdownClasses, className)}
      onClick={(event) => handleThreadMarkdownClick(event, worktreePath, onOpenFile)}
      onKeyDown={(event) => handleThreadMarkdownKeyDown(event, onOpenFile)}
    />
  )
}

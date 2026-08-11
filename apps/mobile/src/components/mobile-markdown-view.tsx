'use dom'

import type { DOMProps } from 'expo/dom'
import { Markdown, type MarkdownComponents } from '@tanstack/markdown/react'
import { calloutsExtension } from '@tanstack/markdown/extensions/callouts'
import type { InlineNode, MarkdownExtension } from '@tanstack/markdown'

export type MobileMarkdownViewProps = {
  content: string
  onOpenLink(url: string): void
  dom?: DOMProps
}

const styles = `
  :root {
    color-scheme: dark;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    line-height: 1.55;
  }
  * { box-sizing: border-box; }
  html, body, #root { margin: 0; min-width: 0; padding: 0; background: transparent; }
  body { color: #e8edf2; overflow-wrap: anywhere; }
  .markdown-body > :first-child { margin-top: 0; }
  .markdown-body > :last-child { margin-bottom: 0; }
  h1, h2, h3, h4, h5, h6 { color: #f7fafc; line-height: 1.25; margin: 1.2em 0 0.55em; }
  h1, h2 { border-bottom: 1px solid #28313c; padding-bottom: 0.35em; }
  h1 { font-size: 1.55em; }
  h2 { font-size: 1.35em; }
  h3 { font-size: 1.18em; }
  p, blockquote, pre, table, ul, ol { margin: 0.7em 0; }
  ul, ol { padding-left: 1.6em; }
  li + li { margin-top: 0.25em; }
  a { color: #67e8c5; text-decoration: underline; text-underline-offset: 2px; }
  blockquote { border-left: 3px solid #45d6b2; color: #9eabb9; margin-left: 0; padding-left: 0.9em; }
  .markdown-alert { background: #111820; border: 1px solid #34404d; border-left: 3px solid #45d6b2; border-radius: 8px; margin: 0.8em 0; padding: 0.7em 0.9em; }
  .markdown-alert-title { color: #f7fafc; font-weight: 700; margin: 0 0 0.35em; }
  .markdown-alert-content > :first-child { margin-top: 0; }
  .markdown-alert-content > :last-child { margin-bottom: 0; }
  code { background: #151b22; border-radius: 4px; color: #d5dee8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; padding: 0.15em 0.35em; }
  pre { background: #05070a; border: 1px solid #28313c; border-radius: 8px; overflow-x: auto; padding: 12px; -webkit-overflow-scrolling: touch; }
  pre code { background: transparent; padding: 0; white-space: pre; }
  table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
  th, td { border: 1px solid #34404d; padding: 6px 9px; text-align: left; }
  th { background: #151b22; color: #f7fafc; }
  hr { border: 0; border-top: 1px solid #28313c; margin: 1.2em 0; }
  img { border-radius: 6px; height: auto; max-width: 100%; }
  input[type="checkbox"] { accent-color: #45d6b2; margin-right: 0.45em; }
`

function mobileHardBreaks(value: string): InlineNode[] {
  const lines = value.split('\n')
  if (lines.length === 1) return [{ type: 'text', value }]
  const nodes: InlineNode[] = [{ type: 'text', value: lines[0] }]
  for (const line of lines.slice(1)) nodes.push({ type: 'break' }, { type: 'text', value: line })
  return nodes
}

const mobileBreaksExtension: MarkdownExtension = {
  name: 'vertexade-mobile-hard-breaks',
  transformInline(nodes) {
    return nodes.flatMap((node) => (node.type === 'text' ? mobileHardBreaks(node.value) : node))
  },
}
const mobileMarkdownExtensions = [calloutsExtension(), mobileBreaksExtension]

export default function MobileMarkdownView({ content, onOpenLink }: MobileMarkdownViewProps) {
  const components = {
    a: ({ href, children, ...props }) => (
      <a
        {...props}
        href={href}
        onClick={(event) => {
          event.preventDefault()
          if (href) onOpenLink(href)
        }}
      >
        {children}
      </a>
    ),
  } satisfies MarkdownComponents
  return (
    <>
      <style>{styles}</style>
      <main className="markdown-body">
        <Markdown components={components} extensions={mobileMarkdownExtensions} allowHtml={false} frontmatter={false}>
          {content}
        </Markdown>
      </main>
    </>
  )
}

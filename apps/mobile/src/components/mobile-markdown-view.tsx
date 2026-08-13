'use dom'

import type { DOMProps } from 'expo/dom'
import { Markdown, type MarkdownComponents } from '@tanstack/markdown/react'
import { calloutsExtension } from '@tanstack/markdown/extensions/callouts'
import { normalizeMobileMarkdown } from './mobile-markdown-normalize'

export type MobileMarkdownViewProps = {
  content: string
  onOpenLink(url: string): void
  tone?: 'default' | 'onAccent'
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
  p { white-space: pre-wrap; }
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
  details { background: #111820; border: 1px solid #28313c; border-radius: 10px; margin: 0.8em 0; overflow: hidden; padding: 0 12px 10px; }
  summary { color: #f7fafc; cursor: pointer; font-weight: 650; margin: 0 -12px; min-height: 44px; padding: 11px 12px; }
  details[open] summary { border-bottom: 1px solid #28313c; margin-bottom: 10px; }
  details > :last-child { margin-bottom: 0; }
  .markdown-body.on-accent { color: #ffffff; }
  .markdown-body.on-accent h1,
  .markdown-body.on-accent h2,
  .markdown-body.on-accent h3,
  .markdown-body.on-accent h4,
  .markdown-body.on-accent h5,
  .markdown-body.on-accent h6,
  .markdown-body.on-accent a,
  .markdown-body.on-accent blockquote,
  .markdown-body.on-accent summary { color: #ffffff; }
  .markdown-body.on-accent a { text-decoration-color: rgba(255, 255, 255, 0.75); }
  .markdown-body.on-accent code { background: rgba(0, 0, 0, 0.18); color: #ffffff; }
  .markdown-body.on-accent blockquote { border-left-color: rgba(255, 255, 255, 0.7); }
`

const mobileMarkdownExtensions = [calloutsExtension()]

export default function MobileMarkdownView({ content, onOpenLink, tone = 'default' }: MobileMarkdownViewProps) {
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
      <main className={`markdown-body${tone === 'onAccent' ? ' on-accent' : ''}`}>
        <Markdown components={components} extensions={mobileMarkdownExtensions} allowHtml frontmatter={false}>
          {normalizeMobileMarkdown(content)}
        </Markdown>
      </main>
    </>
  )
}

'use dom'

import type { DOMProps } from 'expo/dom'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

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

export default function MobileMarkdownView({ content, onOpenLink }: MobileMarkdownViewProps) {
  return (
    <>
      <style>{styles}</style>
      <main className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          urlTransform={defaultUrlTransform}
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault()
                  if (href) onOpenLink(href)
                }}
              >
                {children}
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </main>
    </>
  )
}

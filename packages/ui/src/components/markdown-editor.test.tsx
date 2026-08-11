import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'
import { MarkdownEditor } from './markdown-editor'

describe('MarkdownEditor', () => {
  it('offers write, preview, and split modes and renders Markdown in preview mode', () => {
    const markup = renderToStaticMarkup(
      <MarkdownEditor id="knowledge" value="**Shared knowledge**" defaultMode="preview" onChange={() => undefined} />,
    )

    expect(markup).toContain('Write')
    expect(markup).toContain('Preview')
    expect(markup).toContain('Split')
    expect(markup).toContain('aria-label="Markdown preview"')
    expect(markup).toContain('<strong>Shared knowledge</strong>')
    expect(markup).toContain('data-markdown-renderer="tanstack-react"')
  })
})

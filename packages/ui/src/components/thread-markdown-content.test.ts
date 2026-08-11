import { Markdown as OctaneMarkdown, type MarkdownProps as OctaneMarkdownProps } from '@tanstack/markdown/octane'
import { renderToStaticMarkup } from 'octane/server'
import { describe, expect, it } from 'vite-plus/test'

import { markdownProfileExtensions } from '@vertexade/ui/lib/markdown-profile'

describe('ThreadMarkdownContent Octane profile', () => {
  it('renders thread Markdown through the Octane adapter with safe streaming defaults', () => {
    const props: OctaneMarkdownProps = {
      children: `## Update

| State | Source |
| --- | --- |
| Ready | src/thread.ts:42 |

> [!TIP]
> Keep going :rocket:.

<script>alert('unsafe')</script>
`,
      extensions: markdownProfileExtensions({ streaming: true }),
      allowHtml: false,
      frontmatter: false,
      headingIds: true,
    }

    const result = renderToStaticMarkup(OctaneMarkdown, props)

    expect(result.html).toContain('<h2 id="update">Update</h2>')
    expect(result.html).toContain('<table>')
    expect(result.html).toContain('worktree://file?path=src%2Fthread.ts&amp;line=42')
    expect(result.html).toContain('markdown-alert-tip')
    expect(result.html).toContain('🚀')
    expect(result.html).toContain('&lt;script&gt;')
    expect(result.html).not.toContain('<script>')
  })

  it('suppresses an incomplete trailing block marker while a thread streams', () => {
    const result = renderToStaticMarkup(OctaneMarkdown, {
      children: 'Completed paragraph\n\n##',
      extensions: markdownProfileExtensions({ streaming: true }),
      allowHtml: false,
      frontmatter: false,
      headingIds: false,
    })

    expect(result.html).toBe('<p>Completed paragraph</p>')
  })
})

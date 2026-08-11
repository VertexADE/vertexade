import { renderToReadableStream, renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { containsMarkdownMath, MarkdownContent } from '@vertexade/ui/components/markdown-content'

describe('MarkdownContent', () => {
  it('loads math support only for Markdown with equation delimiters', () => {
    expect(containsMarkdownMath('A plain update costs $5.')).toBe(false)
    expect(containsMarkdownMath('Tickets cost $5-$10 depending on demand.')).toBe(false)
    expect(containsMarkdownMath(String.raw`An escaped \$variable stays text.`)).toBe(false)
    expect(containsMarkdownMath('Use `$E = mc^2$` as an inline example.')).toBe(false)
    expect(containsMarkdownMath('```md\n$E = mc^2$\n```')).toBe(false)
    expect(containsMarkdownMath('    $E = mc^2$')).toBe(false)
    expect(containsMarkdownMath('Inline $E = mc^2$ equation.')).toBe(true)
    expect(containsMarkdownMath('Block $$x + y$$ equation.')).toBe(true)
    expect(containsMarkdownMath('```md\n$x$\n```\n\nActual $y$ math.')).toBe(true)
    expect(containsMarkdownMath(String.raw`LaTeX \(x + y\) equation.`)).toBe(true)
    expect(containsMarkdownMath(String.raw`Use \(\alpha + \beta\) in prose.`)).toBe(true)
  })

  it('renders GitHub-flavored Markdown and turns source references into file buttons', () => {
    const content = `## Findings

| Priority | Source |
| --- | --- |
| P1 | \`src/routes/index.tsx:42\` |

Also inspect src/components/thread-dialog.tsx:120, [the API](dashboard-server.ts#L570), and [an absolute reference](/tmp/worktree/src/server.ts:8).
`
    const markup = renderToStaticMarkup(<MarkdownContent content={content} worktreePath="/tmp/worktree" onOpenFile={() => {}} />)

    expect(markup).toContain('data-markdown-renderer="tanstack-react"')
    expect(markup).toContain('<h2')
    expect(markup).toContain('<table')
    expect(markup.match(/type="button"/g)).toHaveLength(4)
    expect(markup).toContain('src/routes/index.tsx:42')
    expect(markup).toContain('src/components/thread-dialog.tsx:120')
    expect(markup).toContain('the API')
  })

  it('renders the VertexADE Markdown profile and keeps embedded HTML inert', async () => {
    const content = `# Release notes
First line
Second line with @octocat, #42, and :rocket:.

> [!WARNING]
> Check the rollout carefully.

- [x] Tests pass
- [ ] Deploy

Footnote here[^ship].

[^ship]: Deployment details.

Inline math $E = mc^2$ and color \`#0969DA\`.

<details open><summary>More</summary><kbd>Ctrl</kbd> + <kbd>K</kbd></details>

<script>alert('unsafe')</script>

\`\`\`mermaid
graph TD
  A --> B
\`\`\`
`
    const stream = await renderToReadableStream(
      <MarkdownContent
        content={content}
        linkBaseUrl="https://github.com/acme/widget/pull/7"
        referencePresentation={{
          providerName: 'GitHub',
          repositoryUrl: 'https://github.com/acme/widget',
          issueUrlTemplate: 'https://github.com/acme/widget/issues/{number}',
          userUrlTemplate: 'https://github.com/{user}',
          teamUrlTemplate: 'https://github.com/orgs/{organization}/teams/{team}',
        }}
      />,
    )
    await stream.allReady
    const markup = await new Response(stream).text()

    expect(markup).toContain('id="release-notes"')
    expect(markup).toContain('<br/>')
    expect(markup).toContain('markdown-alert-warning')
    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain('data-footnote-ref')
    expect(markup).toContain('class="katex"')
    expect(markup).toContain('&lt;details open&gt;')
    expect(markup).not.toContain('<details')
    expect(markup).not.toContain('<kbd')
    expect(markup).toContain('https://github.com/octocat')
    expect(markup).toContain('https://github.com/acme/widget/issues/42')
    expect(markup).toContain('🚀')
    expect(markup).toContain('Rendering diagram')
    expect(markup).not.toContain('<script')
  })
})

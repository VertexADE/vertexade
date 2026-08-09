import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { EntityHeader, EntityWorkspace } from '@vertexade/ui/components/entity-workspace'

describe('entity workspace', () => {
  it('keeps detail inspector content available below the primary content on compact screens', () => {
    const markup = renderToStaticMarkup(<EntityWorkspace inspector={<span>Context</span>}>Evidence</EntityWorkspace>)

    expect(markup).toContain('data-slot="entity-workspace"')
    expect(markup).toContain('data-slot="entity-workspace-inspector"')
    expect(markup).not.toMatch(/entity-workspace-inspector[^>]*\bhidden\b/)
  })

  it('renders a single reusable entity heading surface', () => {
    const markup = renderToStaticMarkup(<EntityHeader eyebrow="PR #42" title="Ship the outcome" metadata="Updated now" />)

    expect(markup).toContain('data-slot="entity-header"')
    expect(markup).toContain('Ship the outcome')
    expect(markup).toContain('Updated now')
  })

  it('offers the full title from compact entity headers', () => {
    const markup = renderToStaticMarkup(<EntityHeader title="A deliberately long outcome title" expandableTitle />)

    expect(markup).toContain('data-slot="entity-title"')
    expect(markup).toContain('line-clamp-2')
    expect(markup).toContain('Read full title')
    expect(markup).toContain('aria-expanded="false"')
  })
})

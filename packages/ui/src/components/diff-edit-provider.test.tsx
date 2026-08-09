import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { createDiffEditor, DiffEditProvider } from '@vertexade/ui/components/diff-edit-provider'

describe('diff edit provider', () => {
  it('mounts the editor provider before an editable surface renders', () => {
    const markup = renderToStaticMarkup(
      <DiffEditProvider>{({ ready, error }) => <span data-ready={ready}>{error || 'Editor ready'}</span>}</DiffEditProvider>,
    )

    expect(markup).toContain('data-ready="true"')
    expect(markup).toContain('Editor ready')
  })

  it('creates an independent editor for each editable surface', () => {
    const first = createDiffEditor({})
    const second = createDiffEditor({})

    expect(first).not.toBe(second)
    first.cleanUp()
    second.cleanUp()
  })
})

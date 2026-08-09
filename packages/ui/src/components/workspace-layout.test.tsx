import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { SidebarInset } from '@vertexade/ui/components/ui/sidebar'

describe('workspace layout', () => {
  it('uses a calm reading width with responsive gutters', () => {
    const markup = renderToStaticMarkup(<WorkspacePage>Workspace</WorkspacePage>)

    expect(markup).toContain('data-slot="workspace-page"')
    expect(markup).toContain('w-full')
    expect(markup).toContain('max-w-[96rem]')
    expect(markup).not.toContain('max-w-none')
  })

  it('keeps the application shell outside the page main landmark', () => {
    const markup = renderToStaticMarkup(<SidebarInset>Shell</SidebarInset>)

    expect(markup.startsWith('<div')).toBe(true)
    expect(markup).toContain('data-slot="sidebar-inset"')
    expect(markup).not.toContain('<main')
  })
})

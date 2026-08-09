import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { FilterBar, FilterBarControls, FilterBarToggle, FilterChip, ToolbarGroup } from './toolbar.tsx'

describe('responsive workspace controls', () => {
  it('keeps mobile search and filter controls in one predictable grid', () => {
    const markup = renderToStaticMarkup(
      <FilterBar>
        <input aria-label="Search" />
        <FilterBarToggle label="Filters" count={2}>
          Filters
        </FilterBarToggle>
        <FilterBarControls open>
          <span>Controls</span>
        </FilterBarControls>
      </FilterBar>,
    )

    expect(markup).toContain('grid-cols-[minmax(0,1fr)_2.25rem]')
    expect(markup).toContain('data-open=\"true\"')
    expect(markup).toContain('>2<')
  })

  it('makes long filter rails swipeable without exposing a persistent scrollbar', () => {
    const markup = renderToStaticMarkup(
      <ToolbarGroup>
        <FilterChip active>All</FilterChip>
        <FilterChip>Needs setup</FilterChip>
      </ToolbarGroup>,
    )

    expect(markup).toContain('overflow-x-auto')
    expect(markup).toContain('[scrollbar-width:none]')
    expect(markup).toContain('snap-start')
  })
})

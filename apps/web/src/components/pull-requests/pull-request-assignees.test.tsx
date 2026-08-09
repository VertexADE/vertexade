import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { PrAssignedPeople } from './pull-request-assignees'

describe('PrAssignedPeople', () => {
  it('renders assigned reviewers with compact overflow context', () => {
    const markup = renderToStaticMarkup(
      <PrAssignedPeople reviewers={[{ login: 'ada' }, { login: 'grace' }, { login: 'linus' }, { login: 'margaret' }]} />,
    )

    expect(markup).toContain('data-pr-assignees')
    expect(markup).toContain('Assigned reviewers: ada, grace, linus, margaret')
    expect(markup).toContain('+1')
    expect(markup).toContain('ada +3')
  })

  it('does not add an unassigned placeholder to the card', () => {
    expect(renderToStaticMarkup(<PrAssignedPeople reviewers={[]} />)).toBe('')
  })
})

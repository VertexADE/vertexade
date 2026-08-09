import { describe, expect, it } from 'vite-plus/test'

import { parseConventionalTitle } from '@vertexade/ui/lib/conventional-title'

describe('parseConventionalTitle', () => {
  it.each([
    ['feat(unified-api): add geo filters', { type: 'feat', scope: 'unified-api', breaking: false, subject: 'add geo filters' }],
    ['fix(portal)!: change authentication', { type: 'fix', scope: 'portal', breaking: true, subject: 'change authentication' }],
    ['CI: deploy main', { type: 'ci', scope: null, breaking: false, subject: 'deploy main' }],
    ['feat!: replace public API', { type: 'feat', scope: null, breaking: true, subject: 'replace public API' }],
  ])('parses %s', (title, expected) => {
    expect(parseConventionalTitle(title)).toEqual(expected)
  })

  it('leaves ordinary PR titles unchanged', () => {
    expect(parseConventionalTitle('Fix swapped site coordinates')).toBeNull()
  })
})

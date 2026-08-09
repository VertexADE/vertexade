import { describe, expect, it } from 'vite-plus/test'

import { highlightOffsets } from '@vertexade/ui/components/global-highlights'

describe('highlightOffsets', () => {
  it('finds every case-insensitive phrase occurrence', () => {
    expect(highlightOffsets('Portal API and portal UI', 'portal')).toEqual([
      { start: 0, end: 6 },
      { start: 15, end: 21 },
    ])
  })

  it('handles empty and missing phrases', () => {
    expect(highlightOffsets('anything', '')).toEqual([])
    expect(highlightOffsets('anything', 'missing')).toEqual([])
  })
})

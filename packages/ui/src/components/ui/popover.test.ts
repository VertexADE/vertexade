import { describe, expect, it } from 'vite-plus/test'
import { popoverContentClassName } from './popover.tsx'

describe('popover content', () => {
  it('remains interactive when portalled from a modal dialog', () => {
    expect(popoverContentClassName).toContain('pointer-events-auto')
  })
})

import { describe, expect, it } from 'vite-plus/test'
import { dialogViewportClassName } from './dialog.tsx'

describe('dialog viewport', () => {
  it('keeps oversized dialog content reachable inside the visual viewport', () => {
    expect(dialogViewportClassName).toContain('fixed inset-0')
    expect(dialogViewportClassName).toContain('overflow-y-auto')
    expect(dialogViewportClassName).toContain('safe-area-inset-top')
    expect(dialogViewportClassName).toContain('place-items-center')
  })
})

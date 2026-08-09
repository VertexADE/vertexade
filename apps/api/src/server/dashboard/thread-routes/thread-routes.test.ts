import { describe, expect, it } from 'vite-plus/test'
import { handleThreadArtifactRoutes } from './artifacts.ts'
import { handleThreadControlRoutes } from './control.ts'
import { handleThreadLifecycleRoutes } from './lifecycle.ts'
import { handleThreadReviewRoutes } from './review.ts'

describe('thread route ownership', () => {
  it('exposes one callable handler per route family', () => {
    expect([handleThreadControlRoutes, handleThreadLifecycleRoutes, handleThreadReviewRoutes, handleThreadArtifactRoutes]).toEqual([
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    ])
  })
})

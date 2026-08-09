import { describe, expect, it, vi } from 'vite-plus/test'
import type { FileDiffMetadata } from '@pierre/diffs'

import { createDiffFileContentsLoader, diffAnnotationSlot } from '@vertexade/ui/components/diff-review'

describe('diff review editing', () => {
  it('hydrates a partial diff with base and current file contents before editing', async () => {
    const loadFile = vi.fn(async (path: string, revision: 'base' | 'current') => `${revision}:${path}`)
    const loader = createDiffFileContentsLoader(loadFile)

    await expect(loader({ name: 'src/new.ts', prevName: 'src/old.ts' } as FileDiffMetadata)).resolves.toEqual({
      oldFile: {
        name: 'src/old.ts',
        contents: 'base:src/old.ts',
        cacheKey: 'base:src/old.ts',
      },
      newFile: {
        name: 'src/new.ts',
        contents: 'current:src/new.ts',
        cacheKey: 'current:src/new.ts',
      },
    })
    expect(loadFile).toHaveBeenNthCalledWith(1, 'src/old.ts', 'base')
    expect(loadFile).toHaveBeenNthCalledWith(2, 'src/new.ts', 'current')
  })

  it('targets the rendered annotation slot for either side of a diff', () => {
    expect(diffAnnotationSlot({ line: 155, side: 'RIGHT' })).toBe('annotation-additions-155')
    expect(diffAnnotationSlot({ line: 42, side: 'LEFT' })).toBe('annotation-deletions-42')
  })
})

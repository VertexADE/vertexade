import { describe, expect, it } from 'vite-plus/test'
import type { DiffFile } from '@vertexade/ui/lib/dashboard-types'
import { buildDiffFileTree } from './diff-file-tree.tsx'

function changed(path: string, status: DiffFile['status'] = 'modified'): DiffFile {
  return { path, status, additions: 2, deletions: 1, binary: false }
}

describe('buildDiffFileTree', () => {
  it('groups changed files into sorted folders while preserving source indexes', () => {
    expect(
      buildDiffFileTree([
        changed('packages/ui/src/button.tsx'),
        changed('README.md'),
        changed('apps/api/index.ts', 'added'),
        changed('packages/ui/src/avatar.tsx'),
      ]),
    ).toMatchObject([
      {
        kind: 'folder',
        name: 'apps',
        path: 'apps',
        fileCount: 1,
        children: [
          {
            name: 'api',
            path: 'apps/api',
            children: [{ kind: 'file', name: 'index.ts', index: 2 }],
          },
        ],
      },
      {
        kind: 'folder',
        name: 'packages',
        path: 'packages',
        fileCount: 2,
        children: [
          {
            name: 'ui',
            path: 'packages/ui',
            children: [
              {
                name: 'src',
                path: 'packages/ui/src',
                children: [
                  { kind: 'file', name: 'avatar.tsx', index: 3 },
                  { kind: 'file', name: 'button.tsx', index: 0 },
                ],
              },
            ],
          },
        ],
      },
      { kind: 'file', name: 'README.md', index: 1 },
    ])
  })
})

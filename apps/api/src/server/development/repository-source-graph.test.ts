import { describe, expect, it } from 'vite-plus/test'
import { buildRepositorySourceGraph } from './repository-source-graph.ts'

describe('repository source graph', () => {
  it('resolves relative and workspace-package relationships with revision-bound citations', async () => {
    const output = [
      'abc:apps/web/src/view.ts:2:import { shared } from "../../../packages/shared/src/index"',
      'abc:apps/api/src/server.ts:4:import { shared } from "@fixture/shared"',
      'abc:apps/api/src/feature.ts:5:import { feature } from "@fixture/shared/feature"',
      'abc:apps/api/src/comment.ts:6:// import { feature } from "@fixture/shared/feature"',
      'abc:packages/shared/src/index.ts:1:export const shared = true',
      'abc:packages/shared/src/feature.ts:1:export const feature = true',
    ].join('\n')
    const graph = await buildRepositorySourceGraph({
      repository: { localPath: '/fixture' },
      revision: 'abc',
      paths: [
        'apps/web/src/view.ts',
        'apps/api/src/server.ts',
        'apps/api/src/feature.ts',
        'apps/api/src/comment.ts',
        'packages/shared/src/index.ts',
        'packages/shared/src/feature.ts',
      ],
      boundaries: [
        { key: 'root', rootPath: '', packageName: null },
        { key: 'web', rootPath: 'apps/web', packageName: '@fixture/web' },
        { key: 'api', rootPath: 'apps/api', packageName: '@fixture/api' },
        { key: 'shared', rootPath: 'packages/shared', packageName: '@fixture/shared' },
      ],
      run: async () => output,
    })

    expect(graph).toMatchObject({ revision: 'abc', sourceFileCount: 6, edgeCount: 3 })
    expect(graph.edges).toEqual([
      expect.objectContaining({ fromPath: 'apps/api/src/feature.ts', toPath: 'packages/shared/src/feature.ts', line: 5 }),
      expect.objectContaining({ fromPath: 'apps/api/src/server.ts', toPath: 'packages/shared/src/index.ts', line: 4 }),
      expect.objectContaining({ fromPath: 'apps/web/src/view.ts', toPath: 'packages/shared/src/index.ts', line: 2 }),
    ])
    expect(graph.digest).toHaveLength(64)
  })

  it('records an explicit warning when source discovery fails', async () => {
    const graph = await buildRepositorySourceGraph({
      repository: { localPath: '/fixture' },
      revision: 'abc',
      paths: ['src/index.ts'],
      boundaries: [{ key: 'root', rootPath: '', packageName: null }],
      run: async () => {
        throw new Error('git process failed')
      },
    })

    expect(graph.edges).toEqual([])
    expect(graph.warnings).toEqual([expect.objectContaining({ code: 'source_graph_unavailable' })])
  })
})

import { describe, expect, it } from 'vite-plus/test'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { vertexDataDirectory, vertexWorktreeDirectory } from './configuration.ts'

describe('VertexADE storage locations', () => {
  it('uses the XDG data home when configured and a private home directory otherwise', () => {
    expect(vertexDataDirectory({ XDG_DATA_HOME: '/data' })).toBe('/data/vertex-ade')
    expect(vertexDataDirectory({})).toBe(join(homedir(), '.vertex-ade'))
    expect(vertexDataDirectory({ VERTEXADE_DATA_DIR: '/custom/data' })).toBe('/custom/data')
  })

  it('can group managed agent worktrees below one configured root', () => {
    expect(vertexWorktreeDirectory('codex', '/native/codex', { VERTEXADE_WORKTREE_ROOT: '/managed' })).toBe('/managed/codex')
    expect(vertexWorktreeDirectory('codex', '/native/codex', {})).toBe('/native/codex')
  })
})

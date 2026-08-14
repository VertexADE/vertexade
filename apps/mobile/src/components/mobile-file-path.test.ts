import { displayMobileFilePath } from './mobile-file-path'

describe('displayMobileFilePath', () => {
  test('shows paths relative to the active worktree', () => {
    expect(displayMobileFilePath(
      '/Users/dominicvonk/.vertex-ade/work-items/W-0012/vertexade/apps/mobile/app.tsx',
      '/Users/dominicvonk/.vertex-ade/work-items/W-0012',
    )).toBe('vertexade/apps/mobile/app.tsx')
  })

  test('removes work-item roots even when the reported root differs', () => {
    expect(displayMobileFilePath(
      '/Users/dominicvonk/.vertex-ade/work-items/W-0012/vertexade/apps/mobile/app.tsx',
    )).toBe('vertexade/apps/mobile/app.tsx')
  })

  test('shortens user-owned paths without losing their context', () => {
    expect(displayMobileFilePath('/Users/dominicvonk/.codex/memories/MEMORY.md')).toBe('~/.codex/memories/MEMORY.md')
  })
})

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vite-plus/test'
import { allocateAgentWorktree } from './agent-worktree.ts'

describe('agent worktree allocation', () => {
  it('reuses the stable combined repository worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vertexade-combined-'))
    const worktree = join(root, 'work-items', 'W-0042', 'acme--api')
    await mkdir(worktree, { recursive: true })
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes('--git-common-dir')) return '/repos/acme-api/.git'
      if (args.includes('--show-current')) return 'feature/shared-work'
      if (args.at(-1) === 'HEAD') return 'current-head'
      return ''
    })

    const result = await allocateAgentWorktree(
      { full_name: 'acme/api', local_path: '/repos/acme-api' },
      { workspaceRoot: root },
      'origin/main',
      'feature/new-branch',
      { mode: 'combined', workItemKey: 'W-0042' },
      { run, prepare: vi.fn(), cleanup: vi.fn() },
    )

    expect(result).toMatchObject({
      worktree,
      branchName: 'feature/shared-work',
      headSha: 'current-head',
      created: false,
    })
    expect(run.mock.calls.flat(2)).not.toContain('add')
  })
})

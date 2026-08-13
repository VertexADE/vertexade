import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vite-plus/test'
import { allocateAgentWorktree } from './agent-worktree.ts'

describe('agent worktree allocation', () => {
  it('uses a plain local directory directly without invoking Git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vertexade-direct-'))
    const prepare = vi.fn()
    const run = vi.fn()
    const result = await allocateAgentWorktree(
      { full_name: 'Local/docs', local_path: root, source_kind: 'directory', workspace_strategy: 'direct' },
      { workspaceRoot: join(root, 'agents') },
      '',
      null,
      { workItemKey: 'W-0001' },
      { run, prepare, cleanup: vi.fn() },
    )
    expect(result).toMatchObject({ worktree: root, sessionCwd: root, workspaceStrategy: 'direct', baseGitDir: null })
    expect(run).not.toHaveBeenCalled()
    expect(prepare).toHaveBeenCalledOnce()
  })

  it('reuses the stable combined repository worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vertexade-combined-'))
    const agentWorkspaceRoot = join(root, 'agents', 'codex')
    const workItemWorkspaceRoot = join(root, '.vertex-ade', 'work-items')
    const worktree = join(workItemWorkspaceRoot, 'W-0042', 'acme--api')
    await mkdir(worktree, { recursive: true })
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes('--git-common-dir')) return '/repos/acme-api/.git'
      if (args.includes('--show-current')) return 'feature/shared-work'
      if (args.at(-1) === 'HEAD') return 'current-head'
      return ''
    })
    const prepare = vi.fn()
    const assertReusable = vi.fn()

    const result = await allocateAgentWorktree(
      { full_name: 'acme/api', local_path: '/repos/acme-api' },
      { workspaceRoot: agentWorkspaceRoot },
      'origin/main',
      'feature/new-branch',
      { mode: 'combined', workItemKey: 'W-0042' },
      { run, workItemWorkspaceRoot, assertReusable, prepare, cleanup: vi.fn() },
    )

    expect(result).toMatchObject({
      worktree,
      branchName: 'feature/shared-work',
      headSha: 'current-head',
      created: false,
    })
    expect(run.mock.calls.flat(2)).not.toContain('add')
    expect(assertReusable).toHaveBeenCalledWith({ full_name: 'acme/api', local_path: '/repos/acme-api' }, worktree)
    expect(assertReusable.mock.invocationCallOrder[0]).toBeLessThan(prepare.mock.invocationCallOrder[0]!)
    expect(prepare).toHaveBeenCalledWith({ full_name: 'acme/api', local_path: '/repos/acme-api' }, worktree, {
      workspaceRoot: agentWorkspaceRoot,
    })
  })
})

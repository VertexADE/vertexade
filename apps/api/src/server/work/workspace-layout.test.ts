import { describe, expect, it } from 'vite-plus/test'
import {
  jobSessionCwd,
  parseWorkItemWorkspaceMode,
  relativeWorktreePath,
  workItemLaunchWorkspaceMode,
  workItemWorkspaceLayout,
} from './workspace-layout.ts'

describe('Work item workspace layout', () => {
  it('groups repository worktrees below one stable Work item root', () => {
    const layout = workItemWorkspaceLayout({
      agentWorkspaceRoot: '/managed/codex',
      workItemKey: 'W-0042',
      repositoryFullName: 'acme/api',
      repositoryPath: '/repos/api',
      mode: 'combined',
      identifier: '12345678-abcd',
    })

    expect(layout).toEqual({
      mode: 'combined',
      root: '/managed/codex/work-items/W-0042',
      worktree: '/managed/codex/work-items/W-0042/acme--api',
    })
    expect(relativeWorktreePath(layout.root, layout.worktree)).toBe('acme--api')
    expect(
      jobSessionCwd(
        {
          workspace_mode: 'combined',
          session_cwd: layout.root,
          worktree_path: layout.worktree,
        },
        '/managed/codex',
      ),
    ).toBe(layout.root)
  })

  it('uses the same repository path across launch identifiers', () => {
    const input = {
      agentWorkspaceRoot: '/managed/codex',
      workItemKey: 'W-0042',
      repositoryFullName: 'acme/api',
      repositoryPath: '/repos/api',
      mode: 'combined' as const,
    }

    expect(workItemWorkspaceLayout({ ...input, identifier: 'first-run' }).worktree).toBe(
      workItemWorkspaceLayout({ ...input, identifier: 'second-run' }).worktree,
    )
  })

  it('keeps isolated review and child runs inside their owning Work item', () => {
    const layout = workItemWorkspaceLayout({
      agentWorkspaceRoot: '/managed/codex',
      workItemKey: 'W-0042',
      repositoryFullName: 'acme/api',
      repositoryPath: '/repos/api',
      mode: 'combined',
      identifier: 'ignored',
      isolationKey: 'review-17',
    })

    expect(layout).toEqual({
      mode: 'combined',
      root: '/managed/codex/work-items/W-0042/runs/review-17',
      worktree: '/managed/codex/work-items/W-0042/runs/review-17/acme--api',
    })
  })

  it('preserves the existing per-repository layout and cwd', () => {
    const layout = workItemWorkspaceLayout({
      agentWorkspaceRoot: '/managed/codex',
      workItemKey: 'W-0042',
      repositoryFullName: 'acme/api',
      repositoryPath: '/repos/api',
      mode: 'repository',
      identifier: '12345678-abcd',
    })

    expect(layout).toEqual({
      mode: 'repository',
      root: '/managed/codex/12345678-abcd/api',
      worktree: '/managed/codex/12345678-abcd/api',
    })
    expect(jobSessionCwd({ workspace_mode: 'repository', worktree_path: layout.worktree }, '/managed/codex')).toBe(layout.worktree)
  })

  it('rejects invalid modes and combined roots that do not contain the worktree', () => {
    expect(parseWorkItemWorkspaceMode(undefined)).toBe('combined')
    expect(() => parseWorkItemWorkspaceMode('shared')).toThrow('combined or repository')
    expect(workItemLaunchWorkspaceMode(undefined)).toBe('combined')
    expect(() => workItemLaunchWorkspaceMode('repository')).toThrow('Repository-scoped Work folders have been removed')
    expect(() =>
      jobSessionCwd(
        {
          workspace_mode: 'combined',
          session_cwd: '/managed/codex/work-items/W-0042',
          worktree_path: '/managed/codex/other/api',
        },
        '/managed/codex',
      ),
    ).toThrow('does not contain')
  })
})

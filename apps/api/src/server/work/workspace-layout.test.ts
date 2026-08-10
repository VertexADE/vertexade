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
      workItemWorkspaceRoot: '/home/example/.vertex-ade/work-items',
      workItemKey: 'W-0042',
      repositoryFullName: 'acme/api',
      repositoryPath: '/repos/api',
      mode: 'combined',
      identifier: '12345678-abcd',
    })

    expect(layout).toEqual({
      mode: 'combined',
      root: '/home/example/.vertex-ade/work-items/W-0042',
      worktree: '/home/example/.vertex-ade/work-items/W-0042/acme--api',
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
        '/home/example/.vertex-ade/work-items',
      ),
    ).toBe(layout.root)
  })

  it('uses the same repository path across agents and launch identifiers', () => {
    const input = {
      agentWorkspaceRoot: '/managed/codex',
      workItemWorkspaceRoot: '/home/example/.vertex-ade/work-items',
      workItemKey: 'W-0042',
      repositoryFullName: 'acme/api',
      repositoryPath: '/repos/api',
      mode: 'combined' as const,
    }

    expect(workItemWorkspaceLayout({ ...input, agentWorkspaceRoot: '/managed/codex', identifier: 'first-run' }).worktree).toBe(
      workItemWorkspaceLayout({ ...input, agentWorkspaceRoot: '/managed/claude', identifier: 'second-run' }).worktree,
    )
  })

  it('does not create a second repository worktree for another thread', () => {
    const layout = workItemWorkspaceLayout({
      agentWorkspaceRoot: '/managed/codex',
      workItemWorkspaceRoot: '/home/example/.vertex-ade/work-items',
      workItemKey: 'W-0042',
      repositoryFullName: 'acme/api',
      repositoryPath: '/repos/api',
      mode: 'combined',
      identifier: 'review-17',
    })

    expect(layout).toEqual({
      mode: 'combined',
      root: '/home/example/.vertex-ade/work-items/W-0042',
      worktree: '/home/example/.vertex-ade/work-items/W-0042/acme--api',
    })
  })

  it('preserves the existing per-repository layout and cwd', () => {
    const layout = workItemWorkspaceLayout({
      agentWorkspaceRoot: '/managed/codex',
      workItemWorkspaceRoot: '/home/example/.vertex-ade/work-items',
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
        '/home/example/.vertex-ade/work-items',
      ),
    ).toThrow('does not contain')
  })

  it('keeps legacy combined Work item paths readable without using them for new layouts', () => {
    expect(
      jobSessionCwd(
        {
          workspace_mode: 'combined',
          session_cwd: '/managed/codex/work-items/W-0042',
          worktree_path: '/managed/codex/work-items/W-0042/acme--api',
        },
        '/managed/codex',
        '/home/example/.vertex-ade/work-items',
      ),
    ).toBe('/managed/codex/work-items/W-0042')
  })
})

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'

const root = fileURLToPath(new URL('..', import.meta.url))

async function sources(...paths: string[]) {
  return (await Promise.all(paths.map((path) => readFile(join(root, path), 'utf8')))).join('\n')
}

describe('wave five public behavior inventory', () => {
  it('keeps every thread endpoint represented exactly once', async () => {
    const source = await sources(
      'apps/api/src/server/dashboard/thread-api.ts',
      'apps/api/src/server/dashboard/thread-routes/control.ts',
      'apps/api/src/server/dashboard/thread-routes/review.ts',
      'apps/api/src/server/dashboard/thread-routes/lifecycle.ts',
      'apps/api/src/server/dashboard/thread-routes/artifacts.ts',
    )
    const routeEntries = [
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/follow-up$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/steer$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/queue$/",
      "method: 'PATCH', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/queue$/",
      "method: 'DELETE', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/queue\\/(\\d+)$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/queue\\/(\\d+)\\/steer$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/retry$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/re-review$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/fork$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/save-stack-tasks$/",
      "method: 'POST', pattern: /^\\/api\\/pr-tasks\\/(\\d+)$/",
      "method: 'POST', pattern: /^\\/api\\/pr-tasks\\/(\\d+)\\/(approve|approve-auto-merge)$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/archive$/",
      "method: 'DELETE', pattern: /^\\/api\\/agent-threads\\/(\\d+)$/",
      "method: 'POST', pattern: /^\\/api\\/cleanup-worktrees\\/(\\d+)\\/remove$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/handoff$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/input$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/cancel$/",
      "method: 'GET', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/file$/",
      "method: 'GET', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/suggestions$/",
      "method: 'POST', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/suggestions$/",
      "method: 'GET', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/log$/",
      "method: 'GET', pattern: /^\\/api\\/agent-threads\\/(\\d+)\\/diff$/",
    ]

    const normalized = source.replace(/\s+/g, ' ')
    for (const entry of routeEntries) expect(normalized.split(entry)).toHaveLength(2)
  })

  it('preserves the thread activity composer and responsive action contracts', async () => {
    const source = await sources(
      'packages/ui/src/components/thread-panel.tsx',
      'packages/ui/src/components/thread-panel-actions.tsx',
      'packages/ui/src/components/thread-panel-tabs.tsx',
      'packages/ui/src/hooks/use-thread-panel-actions.ts',
      'packages/ui/src/hooks/use-thread-panel-follow-up-actions.ts',
      'packages/ui/src/hooks/use-thread-panel-run-actions.ts',
      'packages/ui/src/hooks/use-thread-panel-data.ts',
    )

    expect(source).toContain("activityOnly ? 'activity'")
    expect(source).toContain('showFollowUpComposer')
    expect(source).toContain('onSteerQueued={actions.steerQueuedFollowUp}')
    expect(source).toContain('onCancelQueued={actions.cancelQueuedFollowUp}')
    expect(source).toContain('sm:hidden')
    expect(source).toContain('sm:flex')
    expect(source).toContain('`/api/agent-threads/${job.id}/interrupt`')
    expect(source).toContain('`/api/agent-threads/${job.id}/retry`')
  })

  it('preserves portable collection state and preference boundaries', async () => {
    const source = await sources(
      'packages/ui/src/components/portable-extension-host.tsx',
      'packages/ui/src/components/portable-extension-model.ts',
      'packages/ui/src/hooks/use-portable-board-preferences.ts',
      'packages/ui/src/hooks/use-portable-collection-workspace.ts',
      'packages/ui/src/hooks/use-portable-detail.ts',
    )

    expect(source).toContain('`${moduleId}:${surface.id}`')
    expect(source).toContain('preferences.value.extensionBoards')
    expect(source).toContain('controlled === undefined ? local : controlled')
    expect(source).toContain('orderPortableHierarchy')
    expect(source).toContain('projectPortableSwimlanes')
    expect(source).toContain('PortableMobileStages')
    expect(source).toContain('PortableActionDialog')
  })

  it('preserves pull-request filter, route, and responsive detail contracts', async () => {
    const source = await sources(
      'apps/web/src/routes/pull-requests.tsx',
      'apps/web/src/components/pull-requests/pull-request-queue-model.ts',
      'apps/web/src/components/pull-requests/pull-request-workspaces.tsx',
    )

    expect(source).toContain("pullRequestFilterStorageKey = 'vertexade.filters.v2'")
    for (const key of [
      'repo',
      'pr',
      'thread',
      'tab',
      'view',
      'q',
      'repos',
      'status',
      'author',
      'reviewer',
      'checks',
      'age',
      'label',
      'branch',
    ]) {
      expect(source).toContain(`${key}:`)
    }
    expect(source).toContain("to: '/pull-requests/$repoId/$prNumber'")
    expect(source).toContain('LazyPrDetailsDialog')
    expect(source).toContain('MobilePullRequestFilters')
    expect(source).toContain("if (view === 'mine') return 'for-you'")
    expect(source).toContain('const openReview = (pr: PullRequest) => setReviewPr(pr)')
    expect(source).not.toContain('`/api/pulls/${pr.repo_id}/${pr.number}/work`')
  })

  it('preserves automation mutation and controlled-view contracts', async () => {
    const source = await sources(
      'packages/ui/src/components/automation-recipes.tsx',
      'packages/ui/src/components/automation-recipes-model.ts',
      'packages/ui/src/hooks/use-automation-actions.ts',
      'packages/ui/src/hooks/use-automation-draft.ts',
      'packages/ui/src/hooks/use-automation-overview.ts',
    )

    expect(source).toContain('const activeView = controlledView ?? view')
    expect(source).toContain('onViewChange?.(nextView)')
    expect(source).toContain("triggerId === 'core.scheduled'")
    expect(source).toContain('/api/automation-recipes/${recipe.id}/run')
    expect(source).toContain('/api/automation-runs/${run.id}/approval')
    expect(source).toContain("'/api/automation-runtime'")
  })
})

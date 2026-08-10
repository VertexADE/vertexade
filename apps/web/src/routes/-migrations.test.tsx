import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { MigrationCampaign } from '@vertexade/platform-contracts'
import { CampaignCard } from './migrations.tsx'

describe('CampaignCard', () => {
  it('shows frozen recipe, server ownership, canary prediction, and separate write and PR approvals', () => {
    const campaign = {
      id: 1_000_000_012,
      backend_id: 'team',
      backend_name: 'Team server',
      backend_local_id: 12,
      federationGroupId: 'group-1',
      recipe: {
        id: 1_000_000_003,
        key: 'node-types',
        name: 'Upgrade Node types',
        description: 'Upgrade Node types.',
        version: 2,
        kind: 'dependency_upgrade',
        configuration: {
          kind: 'dependency_upgrade',
          packageName: '@types/node',
          targetVersion: '^24.0.0',
          sections: ['devDependencies'],
        },
        validationKinds: ['typecheck', 'test'],
        defaultCanaryCount: 1,
        defaultWaveSize: 5,
        rollbackGuidance: 'Restore the previous range.',
        creator: 'maintainer',
        createdAt: 'now',
      },
      state: 'awaiting_approval',
      canaryCount: 1,
      waveSize: 5,
      concurrency: 2,
      writesApproved: false,
      createPullRequests: false,
      currentWave: 0,
      creator: 'maintainer',
      targets: [
        {
          id: 1_000_000_004,
          campaignId: 1_000_000_012,
          repositoryId: 1_000_000_007,
          repositoryName: 'fixture/repository',
          baseRevision: 'a'.repeat(40),
          wave: 0,
          state: 'preflight_succeeded',
          applicability: 'applicable',
          applicabilityReason: '@types/node uses ^22.0.0',
          predictedChanges: [{ path: 'package.json', summary: 'Update @types/node', before: '^22.0.0', after: '^24.0.0' }],
          workItemId: null,
          jobId: null,
          pullRequestNumber: null,
          pullRequestUrl: null,
          impactAnalysisId: null,
          outputRevision: null,
          validationRunIds: [],
          evidenceSnapshotId: null,
          error: null,
          attemptCount: 1,
          updatedAt: 'now',
        },
      ],
      counts: {
        pending: 0,
        not_applicable: 0,
        preflight_succeeded: 1,
        preflight_failed: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
        stale: 0,
      },
      createdAt: 'now',
      updatedAt: 'now',
      startedAt: null,
      finishedAt: null,
    } satisfies MigrationCampaign & { backend_id: string; backend_name: string; backend_local_id: number }
    const html = renderToStaticMarkup(
      <CampaignCard
        campaign={campaign}
        busy={false}
        writeApproved={false}
        createPullRequests={false}
        onWriteApprovedChange={vi.fn()}
        onCreatePullRequestsChange={vi.fn()}
        onControl={vi.fn()}
      />,
    )
    expect(html).toContain('Team server')
    expect(html).toContain('Child #12')
    expect(html).toContain('recipe v2')
    expect(html).toContain('Wave canary')
    expect(html).toContain('^22.0.0')
    expect(html).toContain('Approve repository writes')
    expect(html).toContain('Also authorize draft pull-request creation')
  })
})

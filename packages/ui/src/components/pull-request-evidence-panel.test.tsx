import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { PullRequestEvidenceSnapshot } from '@vertexade/platform-contracts'
import { PullRequestEvidenceView } from './pull-request-evidence-panel.tsx'

describe('PullRequestEvidenceView', () => {
  it('groups current-head proof by decision and keeps failed, unknown, stale, and waived evidence explicit', () => {
    const snapshot: PullRequestEvidenceSnapshot = {
      id: 1,
      repositoryId: 2,
      pullRequestNumber: 3,
      headRevision: 'a'.repeat(40),
      policyVersion: 2,
      readiness: 'blocked',
      freshness: 'current',
      counts: { passed: 1, failed: 1, blocked: 0, not_applicable: 0, unknown: 1, stale: 0 },
      digest: 'b'.repeat(64),
      createdAt: '2026-01-01',
      entries: [
        {
          key: 'scope.impact',
          category: 'scope',
          decision: 'scope_understood',
          label: 'Change impact is understood',
          status: 'passed',
          required: true,
          provider: 'core.impact',
          proof: 'Three affected projects.',
          sourceUrl: null,
          entityReference: 'impact:1',
          observedHeadRevision: 'a'.repeat(40),
          capturedAt: 'now',
          executionId: 1,
          action: 'refresh_impact',
          waiver: null,
        },
        {
          key: 'validation.targets',
          category: 'validation',
          decision: 'behavior_validated',
          label: 'Required validation targets pass',
          status: 'failed',
          required: true,
          provider: 'core.validation',
          proof: 'One selected target failed.',
          sourceUrl: null,
          entityReference: 'run:2',
          observedHeadRevision: 'a'.repeat(40),
          capturedAt: 'now',
          executionId: 2,
          action: 'run_validation',
          waiver: null,
        },
        {
          key: 'review.approval',
          category: 'review',
          decision: 'review_resolved',
          label: 'Required review is approved',
          status: 'unknown',
          required: true,
          provider: 'source-control',
          proof: 'No approval decision is available.',
          sourceUrl: 'https://example.invalid/pull/3',
          entityReference: 'fixture#3',
          observedHeadRevision: 'a'.repeat(40),
          capturedAt: 'now',
          executionId: null,
          action: 'request_review',
          waiver: {
            id: 4,
            repositoryId: 2,
            pullRequestNumber: 3,
            headRevision: 'a'.repeat(40),
            entryKey: 'review.approval',
            actor: 'maintainer',
            reason: 'Emergency change approved out of band.',
            expiresAt: null,
            createdAt: 'now',
            revokedAt: null,
          },
        },
      ],
    }
    const html = renderToStaticMarkup(
      <PullRequestEvidenceView
        snapshot={snapshot}
        collecting={false}
        waivingKey={null}
        onCollect={vi.fn()}
        onWaive={vi.fn()}
        onAction={vi.fn()}
      />,
    )
    expect(html).toContain('Head aaaaaaaa')
    expect(html).toContain('Scope understood')
    expect(html).toContain('Behavior validated')
    expect(html).toContain('One selected target failed.')
    expect(html).toContain('waived by maintainer')
    expect(html).toContain('Emergency change approved out of band.')
  })
})

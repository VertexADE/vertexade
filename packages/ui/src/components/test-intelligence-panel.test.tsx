import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { PullRequestTestIntelligence } from '@vertexade/platform-contracts'
import { TestIntelligenceView } from './test-intelligence-panel.tsx'

describe('TestIntelligenceView', () => {
  it('shows selected reasons, coverage gaps, stale state, failure evidence, and repair action', () => {
    const subject = {
      kind: 'pull_request' as const,
      repositoryId: 4,
      pullRequestNumber: 9,
      baseRevision: 'a'.repeat(40),
      headRevision: 'b'.repeat(40),
    }
    const target = {
      id: 'root:test',
      repositoryId: 4,
      projectKey: 'project:root',
      projectLabel: 'root',
      kind: 'test' as const,
      label: 'Root tests',
      script: 'test',
      executable: 'pnpm' as const,
      args: ['test'],
      workingDirectory: '.',
      timeoutMs: 60_000,
      artifactPaths: [],
      source: 'discovered' as const,
      confidence: 'high' as const,
      enabled: true,
    }
    const intelligence = {
      analysis: {
        id: 1,
        executionId: 2,
        subject,
        status: 'succeeded',
        freshness: 'current',
        progress: 100,
        resultVersion: 'test',
        digest: 'd'.repeat(64),
        warningCount: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        finishedAt: '2026-01-01',
        result: {
          analyzerVersion: 'test',
          repositoryName: 'fixture/repository',
          changedFiles: [],
          nodes: [],
          edges: [],
          validationTargets: [{ ...target, reason: 'Public contract changed', required: true }],
          deliveryEffects: [],
          warnings: [],
          summary: {
            directProjects: 1,
            transitiveProjects: 0,
            requiredValidations: 1,
            deliveryEffects: 0,
            contractChanges: 1,
            risk: 'high',
          },
        },
      },
      catalog: {
        repositoryId: 4,
        revision: subject.headRevision,
        packageManager: 'pnpm',
        targets: [target],
        warnings: [],
        generatedAt: 'now',
      },
      selection: {
        impactAnalysisId: 1,
        revision: subject.headRevision,
        selected: [target],
        omissions: [],
        coverageGaps: [{ code: 'uncovered', message: 'No end-to-end target covers the deployment', path: null }],
      },
      runs: [
        {
          id: 3,
          executionId: 4,
          repositoryId: 4,
          impactAnalysisId: 1,
          subject,
          target,
          status: 'failed',
          exitCode: 1,
          durationMs: 1200,
          outputBytes: 50,
          outputTruncated: false,
          failures: [{ fingerprint: 'f', message: 'Expected true', path: 'src/a.test.ts', line: 2, column: 3, suite: 'a', test: 'works' }],
          artifacts: [],
          digest: 'e'.repeat(64),
          freshness: 'stale',
          baseComparison: 'passed',
          repairWorkItemId: null,
          repairJobId: null,
          parentRunId: null,
          repairLoop: null,
          createdAt: 'now',
          startedAt: 'now',
          finishedAt: 'now',
        },
      ],
    } satisfies PullRequestTestIntelligence
    const html = renderToStaticMarkup(
      <TestIntelligenceView
        intelligence={intelligence}
        running={false}
        onRun={vi.fn()}
        onRefresh={vi.fn()}
        onLoadLog={vi.fn()}
        onRepair={vi.fn()}
        onVerifyRepair={vi.fn()}
        onAutoRepair={vi.fn()}
        onCancelRepairLoop={vi.fn()}
      />,
    )
    expect(html).toContain('Public contract changed')
    expect(html).toContain('Coverage gaps')
    expect(html).toContain('No end-to-end target covers the deployment')
    expect(html).toContain('stale')
    expect(html).toContain('src/a.test.ts:2:3')
    expect(html).toContain('Repair with agent')
    const repairStarted = renderToStaticMarkup(
      <TestIntelligenceView
        intelligence={{
          ...intelligence,
          runs: intelligence.runs.map((run) => ({ ...run, repairJobId: 9, repairWorkItemId: 10 })),
        }}
        running={false}
        onRun={vi.fn()}
        onRefresh={vi.fn()}
        onLoadLog={vi.fn()}
        onRepair={vi.fn()}
        onVerifyRepair={vi.fn()}
        onAutoRepair={vi.fn()}
        onCancelRepairLoop={vi.fn()}
      />,
    )
    expect(repairStarted).toContain('Verify repair')
  })
})

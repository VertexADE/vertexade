import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'
import type { ImpactAnalysis } from '@vertexade/platform-contracts'
import { ImpactAnalysisView } from './impact-analysis-panel'

const analysis: ImpactAnalysis = {
  id: 4,
  executionId: 9,
  subject: {
    kind: 'pull_request',
    repositoryId: 2,
    pullRequestNumber: 17,
    baseRevision: 'a'.repeat(40),
    headRevision: 'b'.repeat(40),
  },
  status: 'succeeded',
  freshness: 'stale',
  progress: 1,
  resultVersion: '1.0.0',
  digest: 'c'.repeat(64),
  warningCount: 1,
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:01.000Z',
  finishedAt: '2026-08-10T12:00:01.000Z',
  result: {
    analyzerVersion: '1.0.0',
    repositoryName: 'vertexade/example',
    changedFiles: [{ path: 'packages/core/src/index.ts', previousPath: null, status: 'modified', projectKey: 'project:packages/core' }],
    nodes: [
      {
        key: 'project:packages/core',
        kind: 'package',
        label: '@vertexade/core',
        path: 'packages/core',
        direct: true,
        confidence: 'high',
      },
      {
        key: 'project:apps/web',
        kind: 'package',
        label: '@vertexade/web',
        path: 'apps/web',
        direct: false,
        confidence: 'medium',
      },
    ],
    edges: [
      {
        from: 'project:packages/core',
        to: 'project:apps/web',
        relation: 'consumed_by',
        summary: '@vertexade/web depends on @vertexade/core',
        sourcePath: 'apps/web/package.json',
        confidence: 'high',
      },
    ],
    validationTargets: [
      {
        id: 'project:packages/core:script:test',
        projectKey: 'project:packages/core',
        projectLabel: '@vertexade/core',
        kind: 'test',
        script: 'test',
        reason: '@vertexade/core owns changed files',
        required: true,
        confidence: 'high',
      },
    ],
    deliveryEffects: [],
    warnings: [
      { code: 'validation_gap', message: 'No validation script was discovered for @vertexade/web', path: 'apps/web/package.json' },
    ],
    summary: {
      directProjects: 1,
      transitiveProjects: 1,
      requiredValidations: 1,
      deliveryEffects: 0,
      contractChanges: 1,
      risk: 'high',
    },
  },
}

describe('ImpactAnalysisView', () => {
  it('renders revision freshness, affected consumers, validations, and limitations', () => {
    const markup = renderToStaticMarkup(<ImpactAnalysisView analysis={analysis} running={false} onRefresh={() => undefined} />)
    expect(markup).toContain('high risk')
    expect(markup).toContain('Analysis is stale')
    expect(markup).toContain('@vertexade/core')
    expect(markup).toContain('@vertexade/web')
    expect(markup).toContain('Consumer')
    expect(markup).toContain('No validation script was discovered')
    expect(markup).toContain('apps/web/package.json')
  })
})

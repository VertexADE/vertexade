import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'
import type { ImpactAnalysisListItem } from '@vertexade/platform-contracts'
import { ImpactAnalysisHistory } from './impact-analysis-history'

const analysis: ImpactAnalysisListItem = {
  id: 7,
  executionId: 11,
  subject: {
    kind: 'work_item',
    repositoryId: 2,
    workItemId: 3,
    jobId: 5,
    baseRevision: 'a'.repeat(40),
    headRevision: 'b'.repeat(40),
  },
  status: 'succeeded',
  freshness: 'unknown',
  progress: 1,
  resultVersion: '1.0.0',
  digest: 'c'.repeat(64),
  warningCount: 0,
  createdAt: '2026-08-11T12:00:00.000Z',
  updatedAt: '2026-08-11T12:00:01.000Z',
  finishedAt: '2026-08-11T12:00:01.000Z',
  repositoryName: 'vertexade/example',
  changedFileCount: 4,
  affectedProjectCount: 2,
  risk: 'high',
}

describe('ImpactAnalysisHistory', () => {
  it('summarizes persisted work-item snapshots', () => {
    const markup = renderToStaticMarkup(
      <ImpactAnalysisHistory analyses={[analysis]} selectedId={analysis.id} loading={false} onSelect={() => undefined} />,
    )

    expect(markup).toContain('Analysis history')
    expect(markup).toContain('1 saved')
    expect(markup).toContain('high risk')
    expect(markup).toContain('4 changed files')
    expect(markup).toContain('2 affected projects')
    expect(markup).toContain('aaaaaaaa')
    expect(markup).toContain('bbbbbbbb')
  })
})

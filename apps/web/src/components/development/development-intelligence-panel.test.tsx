import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { DevelopmentInvestigation, DevelopmentKnowledgeEntry } from '@vertexade/platform-contracts'
import { InvestigationTable, KnowledgeTable } from './development-intelligence-panel'

const investigation: DevelopmentInvestigation = {
  jobId: 42,
  workItemId: 17,
  workItemKey: 'W-0017',
  title: 'Investigate impact',
  status: 'completed',
  agentId: 'codex',
  model: 'gpt-5.6',
  reasoningEffort: 'high',
  latestActivity: 'Completed evidence review',
  resultSummary: 'The API boundary has two material consumers.',
  revision: 'a'.repeat(40),
  digest: 'b'.repeat(64),
  createdAt: '2026-08-11T10:00:00Z',
  finishedAt: '2026-08-11T10:05:00Z',
}

const knowledge: DevelopmentKnowledgeEntry = {
  id: 9,
  repositoryId: 1,
  kind: 'ownership',
  scope: 'boundary',
  title: 'API owns the public contract',
  summary: 'The **API service** is accountable for compatibility of the public contract.',
  path: null,
  boundaryKey: 'architecture:service:apps/api',
  confidence: 'high',
  status: 'accepted',
  source: {
    kind: 'impact_analysis',
    id: 3,
    repositoryId: 1,
    revision: 'a'.repeat(40),
    digest: 'b'.repeat(64),
    label: 'Impact analysis #3',
    jobId: 42,
    workItemId: 17,
  },
  supersedesEntryId: null,
  actor: 'operator',
  freshness: 'current',
  createdAt: '2026-08-11T10:06:00Z',
  updatedAt: '2026-08-11T10:06:00Z',
  archivedAt: null,
}

describe('development intelligence tables', () => {
  it('shows durable Work, agent runtime, findings, and promotion controls', () => {
    const html = renderToStaticMarkup(<InvestigationTable investigations={[investigation]} onOpen={vi.fn()} onPromote={vi.fn()} />)
    expect(html).toContain('W-0017')
    expect(html).toContain('The API boundary has two material consumers.')
    expect(html).toContain('Promote')
    expect(html).toContain('data-table-engine="tanstack"')
  })

  it('shows provenance, freshness, supersession, and archival controls', () => {
    const html = renderToStaticMarkup(
      <KnowledgeTable knowledge={[knowledge]} archivingId={null} onSupersede={vi.fn()} onArchive={vi.fn()} />,
    )
    expect(html).toContain('API owns the public contract')
    expect(html).toContain('<strong>API service</strong>')
    expect(html).toContain('architecture:service:apps/api')
    expect(html).toContain('thread #42')
    expect(html).toContain('Supersede')
    expect(html).toContain('Archive')
    expect(html).toContain('data-table-engine="tanstack"')
  })
})

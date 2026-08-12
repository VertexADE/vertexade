import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'
import type { ArchitectureContextPacket } from '@vertexade/platform-contracts'
import { ArchitectureContextView } from './architecture-context-panel'

const citation = { path: 'docs/adrs/ADR-001.md', startLine: 1, endLine: 1, digest: 'a'.repeat(40) }
const packet: ArchitectureContextPacket = {
  id: 1,
  indexId: 2,
  subject: {
    kind: 'pull_request',
    repositoryId: 3,
    pullRequestNumber: 4,
    baseRevision: 'b'.repeat(40),
    headRevision: 'c'.repeat(40),
  },
  revision: 'c'.repeat(40),
  facts: [
    {
      node: {
        key: 'architecture:service:apps/web',
        kind: 'service',
        label: '@vertexade/web',
        summary: null,
        path: 'apps/web',
        citations: [citation],
      },
      reason: 'Matches an impacted path',
      distance: 0,
    },
  ],
  relations: [],
  decisions: [
    {
      id: 'adr-001',
      title: 'ADR-001 Service boundary',
      status: 'accepted',
      scope: 'web',
      supersedes: null,
      citation,
      rule: null,
    },
  ],
  citations: [citation],
  warnings: [{ code: 'architecture_context_truncated', message: 'Context exceeded its byte budget', path: null }],
  byteBudget: 32_000,
  estimatedBytes: 8_000,
  truncated: true,
  digest: 'd'.repeat(64),
  freshness: 'current',
  createdAt: '2026-08-10T12:00:00.000Z',
}

describe('ArchitectureContextView', () => {
  it('renders cited facts, decisions, budget state, and limitations', () => {
    const markup = renderToStaticMarkup(<ArchitectureContextView packet={packet} generating={false} onGenerate={() => undefined} />)
    expect(markup).toContain('Architecture context')
    expect(markup).toContain('Budget limited')
    expect(markup).toContain('@vertexade/web')
    expect(markup).toContain('ADR-001 Service boundary')
    expect(markup).toContain('docs/adrs/ADR-001.md')
    expect(markup).toContain('Context exceeded its byte budget')
  })
})

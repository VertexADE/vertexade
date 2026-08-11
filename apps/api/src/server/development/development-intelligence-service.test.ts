import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { DevelopmentArtifactReference } from '@vertexade/platform-contracts'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, repositories, workItemResources, workItems, workResources } from '../database/schema/tables.ts'
import { DevelopmentIntelligenceService } from './development-intelligence-service.ts'

const databases: Array<{ close(): void }> = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
  const database = openDashboardDatabase(':memory:')
  databases.push(database)
  const repositoryId = Number(
    database.insert(repositories).values({ fullName: 'fixture/repository', cloneUrl: '/fixture', localPath: '/fixture' }).run()
      .lastInsertRowid,
  )
  const workItemId = Number(
    database
      .insert(workItems)
      .values({ key: 'W-0042', title: 'Investigate impact', kind: 'investigation', primaryRepositoryId: repositoryId })
      .run().lastInsertRowid,
  )
  const resourceId = Number(
    database
      .insert(workResources)
      .values({
        provider: 'core',
        kind: 'impact_analysis',
        externalId: '7',
        repositoryId,
        label: 'Impact analysis #7',
        metadata: { revision: 'abc123', digest: 'a'.repeat(64) },
      })
      .run().lastInsertRowid,
  )
  database.insert(workItemResources).values({ workItemId, resourceId, role: 'subject', isPrimary: 1 }).run()
  const jobId = Number(
    database
      .insert(jobs)
      .values({
        repoId: repositoryId,
        prNumber: 0,
        prompt: 'Read-only investigation',
        worktreePath: '/fixture',
        logPath: '/fixture/investigation.log',
        status: 'completed',
        resultText: '# Finding\nThe API package owns this contract.',
        taskTitle: 'Investigate impact',
        workItemId,
      })
      .run().lastInsertRowid,
  )
  const artifact: DevelopmentArtifactReference = {
    kind: 'impact_analysis',
    id: 7,
    repositoryId,
    revision: 'abc123',
    digest: 'a'.repeat(64),
    label: 'Impact analysis #7',
  }
  return { database, repositoryId, workItemId, jobId, artifact }
}

describe('development intelligence service', () => {
  it('keeps investigation output untrusted until an operator explicitly accepts a finding', () => {
    const { database, repositoryId, workItemId, jobId, artifact } = fixture()
    const service = new DevelopmentIntelligenceService(database)

    const before = service.overview(artifact, [])
    expect(before.knowledge).toEqual([])
    expect(before.investigations).toEqual([
      expect.objectContaining({ jobId, workItemId, resultSummary: 'Finding The API package owns this contract.' }),
    ])

    const accepted = service.createKnowledge(artifact, {
      kind: 'ownership',
      scope: 'boundary',
      title: 'API owns the public contract',
      summary: 'The API package is the accountable owner for the public contract.',
      boundaryKey: 'architecture:service:apps/api',
      confidence: 'high',
      sourceJobId: jobId,
      actor: 'fixture-operator',
    })
    expect(accepted).toMatchObject({
      repositoryId,
      status: 'accepted',
      freshness: 'current',
      source: { jobId, workItemId, revision: 'abc123' },
    })
    expect(service.overview(artifact, []).acceptedKnowledgeDigest).not.toBe(before.acceptedKnowledgeDigest)
  })

  it('preserves supersession lineage and archives without deleting evidence', () => {
    const { database, artifact } = fixture()
    const service = new DevelopmentIntelligenceService(database)
    const first = service.createKnowledge(artifact, {
      kind: 'constraint',
      scope: 'repository',
      title: 'First constraint',
      summary: 'The first accepted constraint.',
      confidence: 'medium',
    })
    const replacement = service.createKnowledge(artifact, {
      kind: 'constraint',
      scope: 'repository',
      title: 'Replacement constraint',
      summary: 'The corrected accepted constraint.',
      confidence: 'high',
      supersedesEntryId: first.id,
    })

    expect(service.listKnowledge(artifact.repositoryId, artifact.revision)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, status: 'superseded' }),
        expect.objectContaining({ id: replacement.id, status: 'accepted', supersedesEntryId: first.id }),
      ]),
    )
    expect(service.archiveKnowledge(artifact.repositoryId, replacement.id)).toMatchObject({ status: 'archived' })
    expect(service.listKnowledge(artifact.repositoryId, artifact.revision).map((entry) => entry.id)).not.toContain(replacement.id)
    expect(service.listKnowledge(artifact.repositoryId, artifact.revision, true)).toContainEqual(
      expect.objectContaining({ id: replacement.id, status: 'archived', archivedAt: expect.any(String) }),
    )
  })

  it('rejects promotion from a thread that is not linked to the artifact', () => {
    const { database, artifact } = fixture()
    const service = new DevelopmentIntelligenceService(database)
    expect(() =>
      service.createKnowledge(artifact, {
        kind: 'fact',
        scope: 'repository',
        title: 'Unrelated output',
        summary: 'This output does not belong to the selected artifact.',
        confidence: 'low',
        sourceJobId: 999,
      }),
    ).toThrow('not an investigation for this artifact')
  })
})

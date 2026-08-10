import { describe, expect, it } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { pullRequests, repositories } from '../database/schema/tables.ts'
import type { CommandResult } from '../process.ts'
import { ArchitectureContextService } from './architecture-service.ts'
import { PullRequestEvidenceService } from './evidence-service.ts'
import { ImpactAnalysisService } from './impact-service.ts'
import { ValidationIntelligenceService } from './validation-service.ts'

const unavailableRun = async (): Promise<CommandResult> => {
  throw new Error('Command runner should not be used without an impact analysis')
}

describe('pull-request evidence service', () => {
  it('never treats missing collectors as green, supports revision-scoped waivers, and marks old snapshots stale', async () => {
    const database = openDashboardDatabase(':memory:')
    const repositoryId = Number(
      database.insert(repositories).values({ fullName: 'fixture/repository', cloneUrl: '/fixture', localPath: '/fixture' }).run()
        .lastInsertRowid,
    )
    database
      .insert(pullRequests)
      .values({
        repoId: repositoryId,
        number: 31,
        title: 'Evidence fixture',
        url: 'https://example.invalid/pull/31',
        baseRef: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        reviewDecision: 'APPROVED',
        checksFailed: 0,
        checksPending: 0,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      .run()
    const impact = new ImpactAnalysisService(database, async () => {
      throw new Error('not used')
    })
    const architecture = new ArchitectureContextService(database, async () => {
      throw new Error('not used')
    })
    const validation = new ValidationIntelligenceService(database, impact, unavailableRun)
    const evidence = new PullRequestEvidenceService(database, impact, architecture, validation)

    const missing = await evidence.collect(repositoryId, 31)
    expect(missing.readiness).toBe('unknown')
    expect(missing.entries.find((entry) => entry.key === 'scope.impact')).toMatchObject({ required: true, status: 'unknown' })
    expect(missing.entries.find((entry) => entry.key === 'review.checks')).toMatchObject({ required: true, status: 'passed' })

    const waived = await evidence.addWaiver(repositoryId, 31, {
      entryKey: 'scope.impact',
      actor: 'fixture-user',
      reason: 'Repository does not contain executable code.',
    })
    expect(waived.readiness).toBe('ready')
    expect(waived.entries.find((entry) => entry.key === 'scope.impact')?.waiver).toMatchObject({ actor: 'fixture-user' })

    database
      .update(pullRequests)
      .set({ headSha: 'c'.repeat(40) })
      .run()
    expect(evidence.latest(repositoryId, 31)).toMatchObject({ readiness: 'stale', freshness: 'stale' })
    const newHead = await evidence.collect(repositoryId, 31)
    expect(newHead.readiness).toBe('unknown')
    expect(newHead.entries.find((entry) => entry.key === 'scope.impact')?.waiver).toBeNull()
    database.close()
  })

  it('versions repository policy overrides and validates conditional rules', () => {
    const database = openDashboardDatabase(':memory:')
    const repositoryId = Number(
      database.insert(repositories).values({ fullName: 'fixture/policy', cloneUrl: '/fixture', localPath: '/fixture' }).run()
        .lastInsertRowid,
    )
    const impact = new ImpactAnalysisService(database, async () => '')
    const architecture = new ArchitectureContextService(database, async () => '')
    const validation = new ValidationIntelligenceService(database, impact, unavailableRun)
    const evidence = new PullRequestEvidenceService(database, impact, architecture, validation)
    expect(evidence.policy(repositoryId)).toMatchObject({ repositoryId: null, version: 1 })
    expect(
      evidence.updatePolicy(repositoryId, {
        rules: [{ entryKey: 'scope.impact', required: true, condition: 'always' }],
      }),
    ).toMatchObject({ repositoryId, version: 1 })
    expect(
      evidence.updatePolicy(repositoryId, {
        rules: [{ entryKey: 'release.delivery', required: true, condition: 'delivery_change' }],
      }),
    ).toMatchObject({ repositoryId, version: 2 })
    expect(() => evidence.updatePolicy(repositoryId, { rules: [{ entryKey: 'bad', condition: 'sometimes' }] })).toThrow('condition')
    database.close()
  })
})

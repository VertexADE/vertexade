import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, pullRequests, repositories, workItems } from '../database/schema/tables.ts'
import { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import { runCommand, runCommandResult } from '../process.ts'
import { CapabilityExecutionService } from '../workflows/capability-execution.ts'
import {
  registerCoreArchitectureCapabilities,
  registerCoreDevelopmentCapabilities,
  registerCoreValidationCapabilities,
} from './capabilities.ts'
import { ArchitectureContextService } from './architecture-service.ts'
import { ImpactAnalysisService } from './impact-service.ts'
import { createDevelopmentRoutes, type DevelopmentIntelligenceThreadLauncher, type ValidationRepairLauncher } from './routes.ts'
import { ValidationIntelligenceService } from './validation-service.ts'
import { PullRequestEvidenceService } from './evidence-service.ts'
import { DevelopmentIntelligenceService } from './development-intelligence-service.ts'

const directories: string[] = []
const databases: Array<{ close(): void }> = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function git(repository: string, args: string[]): Promise<string> {
  return runCommand('git', args, { cwd: repository, timeoutMs: 10_000, maxOutputBytes: 1_000_000 })
}

async function repositoryFixture(): Promise<{ path: string; base: string; head: string }> {
  const path = await mkdtemp(join(tmpdir(), 'vertexade-impact-routes-'))
  directories.push(path)
  await mkdir(join(path, 'src'), { recursive: true })
  await writeFile(join(path, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'vitest run' } }))
  await writeFile(join(path, 'src', 'index.ts'), 'export const value = 1\n')
  await git(path, ['init', '--initial-branch=main'])
  await git(path, ['add', '.'])
  await git(path, ['-c', 'user.name=VertexADE', '-c', 'user.email=vertexade@example.invalid', 'commit', '-m', 'base'])
  const base = (await git(path, ['rev-parse', 'HEAD'])).trim()
  await writeFile(join(path, 'src', 'index.ts'), 'export const value = 2\n')
  await git(path, ['add', '.'])
  await git(path, ['-c', 'user.name=VertexADE', '-c', 'user.email=vertexade@example.invalid', 'commit', '-m', 'head'])
  return { path, base, head: (await git(path, ['rev-parse', 'HEAD'])).trim() }
}

function developmentRoutes(
  database: ReturnType<typeof openDashboardDatabase>,
  impact: ImpactAnalysisService,
  architecture: ArchitectureContextService,
  repairLauncher: ValidationRepairLauncher = async () => {
    throw new Error('Repair launcher is not used by this fixture')
  },
  intelligence?: DevelopmentIntelligenceService,
  intelligenceLauncher?: DevelopmentIntelligenceThreadLauncher,
) {
  const registries = new PlatformCapabilityRegistries()
  const validation = new ValidationIntelligenceService(database, impact, runCommandResult)
  registerCoreDevelopmentCapabilities(registries, impact)
  registerCoreArchitectureCapabilities(registries, architecture)
  registerCoreValidationCapabilities(registries, validation)
  const executions = new CapabilityExecutionService(database, registries)
  const evidence = new PullRequestEvidenceService(database, impact, architecture, validation)
  return createDevelopmentRoutes(
    impact,
    architecture,
    validation,
    evidence,
    executions,
    repairLauncher,
    undefined,
    intelligence,
    intelligenceLauncher,
  )
}

describe('development impact routes', () => {
  it('exposes persistent intelligence, read-only investigation launch, explicit promotion, and archival', async () => {
    const fixture = await repositoryFixture()
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const repositoryId = Number(
      database.insert(repositories).values({ fullName: 'fixture/repository', cloneUrl: fixture.path, localPath: fixture.path }).run()
        .lastInsertRowid,
    )
    const impact = new ImpactAnalysisService(database, runCommand)
    const architecture = new ArchitectureContextService(database, runCommand)
    const intelligence = new DevelopmentIntelligenceService(database)
    const launches: Parameters<DevelopmentIntelligenceThreadLauncher>[0][] = []
    const routes = developmentRoutes(database, impact, architecture, undefined, intelligence, async (input) => {
      launches.push(input)
      return { id: 88, work_item_id: 44 }
    })

    const analysisResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/repositories/${repositoryId}/impact-analyses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: fixture.base, headRevision: fixture.head }),
      }),
      {},
    )
    const analysis = (await analysisResponse!.json()) as { id: number; digest: string }

    const overviewResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/repositories/${repositoryId}/impact-analyses/${analysis.id}/intelligence`),
      {},
    )
    expect(await overviewResponse!.json()).toEqual(
      expect.objectContaining({
        artifact: expect.objectContaining({ kind: 'impact_analysis', id: analysis.id, digest: analysis.digest }),
        investigations: [],
        knowledge: [],
      }),
    )

    const launchResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/repositories/${repositoryId}/impact-analyses/${analysis.id}/agent-thread`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'Which consumer is most exposed?' }),
      }),
      {},
    )
    expect(launchResponse?.status).toBe(202)
    expect(await launchResponse!.json()).toEqual(expect.objectContaining({ id: 88, work_item_id: 44 }))
    expect(launches).toEqual([
      expect.objectContaining({
        workflow: 'impact',
        artifactId: analysis.id,
        revision: fixture.head,
        digest: analysis.digest,
        prompt: expect.stringContaining('Which consumer is most exposed?'),
      }),
    ])

    const knowledgeResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/repositories/${repositoryId}/impact-analyses/${analysis.id}/knowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'risk',
          scope: 'path',
          title: 'Public entry point risk',
          summary: 'Changes to the public entry point require consumer validation.',
          path: 'src/index.ts',
          confidence: 'high',
          actor: 'fixture-operator',
        }),
      }),
      {},
    )
    expect(knowledgeResponse?.status).toBe(201)
    const knowledge = (await knowledgeResponse!.json()) as { id: number; status: string }
    expect(knowledge).toEqual(expect.objectContaining({ status: 'accepted' }))

    const archiveResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/repositories/${repositoryId}/development-knowledge/${knowledge.id}/archive`, {
        method: 'POST',
      }),
      {},
    )
    expect(await archiveResponse!.json()).toEqual(expect.objectContaining({ status: 'archived' }))
  })

  it('creates an idempotent revision-bound analysis and marks old PR evidence stale', async () => {
    const fixture = await repositoryFixture()
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const repositoryId = Number(
      database.insert(repositories).values({ fullName: 'fixture/repository', cloneUrl: fixture.path, localPath: fixture.path }).run()
        .lastInsertRowid,
    )
    database
      .insert(pullRequests)
      .values({
        repoId: repositoryId,
        number: 17,
        title: 'Fixture pull request',
        url: 'https://example.invalid/pull/17',
        baseRef: fixture.base,
        headRef: 'feature',
        headSha: fixture.head,
      })
      .run()
    const impact = new ImpactAnalysisService(database, runCommand)
    const architecture = new ArchitectureContextService(database, runCommand)
    const routes = developmentRoutes(database, impact, architecture)

    const create = () =>
      routes.dispatch(new Request(`http://vertexade.test/api/pulls/${repositoryId}/17/impact-analysis`, { method: 'POST' }), {})
    const firstResponse = await create()
    expect(firstResponse?.status).toBe(201)
    const first = (await firstResponse!.json()) as { id: number; executionId: number; freshness: string; digest: string }
    expect(first).toMatchObject({ freshness: 'current' })
    expect(first.digest).toHaveLength(64)

    const secondResponse = await create()
    const second = (await secondResponse!.json()) as { id: number; executionId: number }
    expect(second).toEqual(expect.objectContaining({ id: first.id, executionId: first.executionId }))

    const feedbackResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/repositories/${repositoryId}/impact-analyses/${first.id}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'false_positive',
          nodeKey: 'project:root',
          comment: 'Fixture evidence says this ownership edge is too broad.',
          actor: 'fixture-user',
        }),
      }),
      {},
    )
    expect(feedbackResponse?.status).toBe(201)
    expect(await feedbackResponse!.json()).toEqual(
      expect.objectContaining({ analysisId: first.id, kind: 'false_positive', nodeKey: 'project:root' }),
    )
    expect(impact.get(first.id)?.digest).toBe(first.digest)

    database.update(pullRequests).set({ headSha: fixture.base }).run()
    const latestResponse = await routes.dispatch(new Request(`http://vertexade.test/api/pulls/${repositoryId}/17/impact-analysis`), {})
    const latest = (await latestResponse!.json()) as { analysis: { freshness: string } }
    expect(latest.analysis.freshness).toBe('stale')
  })

  it('builds a revision-cited architecture packet for the current pull-request head', async () => {
    const fixture = await repositoryFixture()
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const repositoryId = Number(
      database.insert(repositories).values({ fullName: 'fixture/repository', cloneUrl: fixture.path, localPath: fixture.path }).run()
        .lastInsertRowid,
    )
    database
      .insert(pullRequests)
      .values({
        repoId: repositoryId,
        number: 18,
        title: 'Architecture context',
        url: 'https://example.invalid/pull/18',
        baseRef: fixture.base,
        headRef: 'feature',
        headSha: fixture.head,
      })
      .run()
    const impact = new ImpactAnalysisService(database, runCommand)
    const architecture = new ArchitectureContextService(database, runCommand)
    const routes = developmentRoutes(database, impact, architecture)

    const response = await routes.dispatch(
      new Request(`http://vertexade.test/api/pulls/${repositoryId}/18/architecture-context`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      {},
    )
    expect(response?.status).toBe(201)
    const packet = (await response!.json()) as {
      id: number
      indexId: number
      freshness: string
      facts: Array<{ node: { label: string; citations: Array<{ path: string; digest: string }> } }>
      digest: string
    }
    expect(packet).toMatchObject({ freshness: 'current' })
    expect(packet.digest).toHaveLength(64)
    expect(packet.facts).toContainEqual(
      expect.objectContaining({ node: expect.objectContaining({ label: 'fixture', citations: expect.any(Array) }) }),
    )
    expect(architecture.latestContextPacket(await architecture.preparePullRequestSubject(repositoryId, 18))).toMatchObject({
      id: packet.id,
    })
  })

  it('routes selected validation, logs, and repair through repository-owned endpoints', async () => {
    const fixture = await repositoryFixture()
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const repositoryId = Number(
      database.insert(repositories).values({ fullName: 'fixture/repository', cloneUrl: fixture.path, localPath: fixture.path }).run()
        .lastInsertRowid,
    )
    database
      .insert(pullRequests)
      .values({
        repoId: repositoryId,
        number: 19,
        title: 'Validation flow',
        url: 'https://example.invalid/pull/19',
        baseRef: fixture.base,
        headRef: 'feature',
        headSha: fixture.head,
      })
      .run()
    const impact = new ImpactAnalysisService(database, runCommand)
    const architecture = new ArchitectureContextService(database, runCommand)
    let repairLaunches = 0
    const routes = developmentRoutes(database, impact, architecture, async ({ linkedWorkItemId }) => {
      repairLaunches += 1
      expect(linkedWorkItemId).toBeNull()
      const workItemId = Number(
        database
          .insert(workItems)
          .values({ key: 'W-REPAIR', title: 'Repair fixture', state: 'active', primaryRepositoryId: repositoryId })
          .run().lastInsertRowid,
      )
      let jobId: number
      try {
        jobId = Number(
          database
            .insert(jobs)
            .values({
              repoId: repositoryId,
              prNumber: 19,
              prompt: 'Repair fixture',
              worktreePath: fixture.path,
              logPath: `${fixture.path}/repair.log`,
              status: 'running',
              workItemId,
            })
            .run().lastInsertRowid,
        )
      } catch (error) {
        const cause = error instanceof Error && 'cause' in error ? String(error.cause) : ''
        throw new Error(`${error instanceof Error ? error.message : String(error)}: ${cause}`)
      }
      return { id: jobId, work_item_id: workItemId }
    })

    const impactResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/pulls/${repositoryId}/19/impact-analysis`, { method: 'POST' }),
      {},
    )
    const impactValue = (await impactResponse!.json()) as {
      result: { nodes: Array<{ key: string; label: string; kind: string }> }
    }
    const project = impactValue.result.nodes.find((node) => node.kind === 'project' || node.kind === 'package')!
    const overrideResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/repositories/${repositoryId}/test-target-overrides`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targets: [
            {
              id: 'fixture:failure',
              projectKey: project.key,
              projectLabel: project.label,
              kind: 'test',
              label: 'Fixture failure',
              script: 'fixture-failure',
              executable: 'node',
              args: ['-e', "console.error('FAIL src/index.ts:1:1 expected 1 to equal 2'); process.exit(1)"],
              workingDirectory: '.',
              timeoutMs: 30_000,
              enabled: true,
            },
          ],
        }),
      }),
      {},
    )
    expect(overrideResponse?.status).toBe(200)
    const runResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/pulls/${repositoryId}/19/validation-runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetIds: ['fixture:failure'], requestId: 'fixture-run' }),
      }),
      {},
    )
    expect(runResponse?.status).toBe(201)
    const runValue = (await runResponse!.json()) as { runs: Array<{ id: number; status: string; repairJobId: number | null }> }
    expect(runValue.runs[0]).toMatchObject({ status: 'failed', repairJobId: null })
    const runId = runValue.runs[0].id

    const logResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/repositories/${repositoryId}/validation-runs/${runId}/log`),
      {},
    )
    expect((await logResponse!.json()) as { output: string }).toEqual(
      expect.objectContaining({ output: expect.stringContaining('expected') }),
    )
    const repairResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/repositories/${repositoryId}/validation-runs/${runId}/repair`, { method: 'POST' }),
      {},
    )
    const repairPayload = await repairResponse!.json()
    expect({ status: repairResponse?.status, payload: repairPayload }).toEqual({
      status: 201,
      payload: expect.objectContaining({ repairJobId: expect.any(Number), repairWorkItemId: expect.any(Number) }),
    })
    expect(repairLaunches).toBe(1)

    const evidenceResponse = await routes.dispatch(
      new Request(`http://vertexade.test/api/pulls/${repositoryId}/19/evidence`, { method: 'POST' }),
      {},
    )
    expect(evidenceResponse?.status).toBe(201)
    expect(await evidenceResponse!.json()).toEqual(
      expect.objectContaining({
        readiness: 'blocked',
        freshness: 'current',
        entries: expect.arrayContaining([expect.objectContaining({ key: 'validation.targets', status: 'failed' })]),
      }),
    )
  })

  it('analyzes committed Work changes without requiring a linked pull request', async () => {
    const fixture = await repositoryFixture()
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const repositoryId = Number(
      database.insert(repositories).values({ fullName: 'fixture/work', cloneUrl: fixture.path, localPath: fixture.path }).run()
        .lastInsertRowid,
    )
    const workItemId = Number(
      database.insert(workItems).values({ key: 'W-IMPACT', title: 'Committed Work impact', primaryRepositoryId: repositoryId }).run()
        .lastInsertRowid,
    )
    const jobId = Number(
      database
        .insert(jobs)
        .values({
          repoId: repositoryId,
          prNumber: 0,
          prompt: 'Implement fixture change',
          worktreePath: fixture.path,
          logPath: `${fixture.path}/work.log`,
          status: 'completed',
          headSha: fixture.base,
          workItemId,
        })
        .run().lastInsertRowid,
    )
    const impact = new ImpactAnalysisService(database, runCommand)
    const architecture = new ArchitectureContextService(database, runCommand)
    const routes = developmentRoutes(database, impact, architecture)
    const response = await routes.dispatch(
      new Request(`http://vertexade.test/api/work-items/${workItemId}/impact-analysis`, { method: 'POST' }),
      {},
    )
    expect(response?.status).toBe(201)
    expect(await response!.json()).toEqual(
      expect.objectContaining({
        subject: expect.objectContaining({ kind: 'work_item', workItemId, jobId, baseRevision: fixture.base, headRevision: fixture.head }),
        result: expect.objectContaining({ changedFiles: [expect.objectContaining({ path: 'src/index.ts' })] }),
      }),
    )
  })
})

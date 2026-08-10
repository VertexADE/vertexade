import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { eq } from 'drizzle-orm'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, repositories, workItems } from '../database/schema/tables.ts'
import { runCommand } from '../process.ts'
import { MigrationCampaignService, type MigrationWorkLauncher } from './migration-service.ts'

const directories: string[] = []
const databases: Array<{ close(): void }> = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function repositoryFixture(name: string, version: string | null): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `vertexade-migration-${name}-`))
  directories.push(path)
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({ name, devDependencies: version ? { '@types/node': version } : { 'vite-plus': '0.2.6' } }, null, 2),
  )
  await runCommand('git', ['init', '--initial-branch=main'], { cwd: path })
  await runCommand('git', ['add', '.'], { cwd: path })
  await runCommand('git', ['-c', 'user.name=VertexADE', '-c', 'user.email=vertexade@example.invalid', 'commit', '-m', 'initial'], {
    cwd: path,
  })
  return path
}

function launcher(database: ReturnType<typeof openDashboardDatabase>): { launch: MigrationWorkLauncher; launches: number[] } {
  const launches: number[] = []
  const launch: MigrationWorkLauncher = async ({ repository, title, prompt, baseRevision }) => {
    const workItemId = Number(
      database
        .insert(workItems)
        .values({
          key: `W-MIG-${repository.id}-${launches.length}`,
          title,
          state: 'active',
          primaryRepositoryId: repository.id,
        })
        .run().lastInsertRowid,
    )
    const jobId = Number(
      database
        .insert(jobs)
        .values({
          repoId: repository.id,
          prNumber: 0,
          prompt,
          worktreePath: repository.localPath,
          logPath: `${repository.localPath}/migration.log`,
          status: 'running',
          headSha: baseRevision,
          workItemId,
        })
        .run().lastInsertRowid,
    )
    launches.push(repository.id)
    return { id: jobId, work_item_id: workItemId }
  }
  return { launch, launches }
}

describe('migration campaign service', () => {
  it('freezes a recipe and revisions, performs non-mutating preflight, and gates canary and later waves', async () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const paths = [
      await repositoryFixture('alpha', '^22.0.0'),
      await repositoryFixture('beta', '^23.0.0'),
      await repositoryFixture('gamma', null),
    ]
    const repositoryIds = paths.map((path, index) =>
      Number(
        database
          .insert(repositories)
          .values({ fullName: `fixture/${String.fromCharCode(97 + index)}`, cloneUrl: path, localPath: path })
          .run().lastInsertRowid,
      ),
    )
    const work = launcher(database)
    const service = new MigrationCampaignService(database, runCommand, work.launch, async ({ target }) => ({
      outputRevision: `${target.baseRevision}-verified`,
      impactAnalysisId: null,
      validationRunIds: [],
      evidenceSnapshotId: null,
      log: 'Verified by fixture',
    }))
    const recipe = service.recipes().find((candidate) => candidate.key === 'node-24-type-definitions')!
    const created = await service.createCampaign({
      federationGroupId: 'group-1',
      recipeId: recipe.id,
      repositoryIds,
      canaryCount: 1,
      waveSize: 1,
      concurrency: 1,
      creator: 'fixture-user',
    })
    expect((await service.createCampaign({ federationGroupId: 'group-1' })).id).toBe(created.id)

    const preflight = await service.control(created.id, { action: 'preflight' })
    expect(preflight).toMatchObject({ state: 'awaiting_approval', writesApproved: false })
    expect(preflight.counts.preflight_succeeded).toBe(2)
    expect(preflight.counts.not_applicable).toBe(1)
    expect(preflight.targets.flatMap((target) => target.predictedChanges)).toContainEqual(
      expect.objectContaining({ path: 'package.json', after: '^24.0.0' }),
    )
    expect(await readFile(join(paths[0], 'package.json'), 'utf8')).toContain('^22.0.0')
    expect(service.attempts(created.id).some((attempt) => attempt.log.includes('Disposable-worktree dry run'))).toBe(true)
    expect(work.launches).toEqual([])

    const canary = await service.control(created.id, { action: 'approve', confirmWrites: true, createPullRequests: false })
    expect(canary.state).toBe('running')
    expect(work.launches).toHaveLength(1)
    const canaryTarget = canary.targets.find((target) => target.state === 'running')!
    database.update(jobs).set({ status: 'completed' }).where(eq(jobs.id, canaryTarget.jobId!)).run()
    const waveGate = await service.control(created.id, { action: 'refresh' })
    expect(waveGate.state).toBe('awaiting_wave_approval')
    expect(work.launches).toHaveLength(1)

    const nextWave = await service.control(created.id, { action: 'approve_wave', confirmWrites: true })
    expect(nextWave.state).toBe('running')
    expect(work.launches).toHaveLength(2)
    const nextTarget = nextWave.targets.find((target) => target.state === 'running')!
    database.update(jobs).set({ status: 'completed' }).where(eq(jobs.id, nextTarget.jobId!)).run()
    const completed = await service.control(created.id, { action: 'refresh' })
    expect(completed.state).toBe('completed')
    expect(completed.counts.succeeded).toBe(2)
    expect(
      completed.targets.filter((target) => target.state === 'succeeded').every((target) => target.outputRevision?.endsWith('-verified')),
    ).toBe(true)
    expect(service.attempts(created.id)).toHaveLength(5)
  })

  it('pauses after a failed canary and never launches a later wave', async () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const paths = [await repositoryFixture('canary', '^22.0.0'), await repositoryFixture('later', '^23.0.0')]
    const repositoryIds = paths.map((path, index) =>
      Number(
        database
          .insert(repositories)
          .values({ fullName: `fixture/failure-${index}`, cloneUrl: path, localPath: path })
          .run().lastInsertRowid,
      ),
    )
    const work = launcher(database)
    const service = new MigrationCampaignService(database, runCommand, work.launch, async ({ target }) => ({
      outputRevision: `${target.baseRevision}-verified`,
      impactAnalysisId: null,
      validationRunIds: [],
      evidenceSnapshotId: null,
      log: 'Verified by fixture',
    }))
    const campaign = await service.createCampaign({
      federationGroupId: 'group-failure',
      recipeId: service.recipes()[0].id,
      repositoryIds,
      canaryCount: 1,
      waveSize: 1,
      concurrency: 1,
      creator: 'fixture-user',
    })
    await service.control(campaign.id, { action: 'preflight' })
    const running = await service.control(campaign.id, { action: 'approve', confirmWrites: true })
    const canary = running.targets.find((target) => target.state === 'running')!
    database.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, canary.jobId!)).run()
    const paused = await service.control(campaign.id, { action: 'refresh' })
    expect(paused.state).toBe('paused')
    expect(paused.counts.failed).toBe(1)
    await expect(service.control(campaign.id, { action: 'resume' })).rejects.toThrow(/retrying or skipping/i)
    expect(work.launches).toHaveLength(1)
    expect(paused.targets.some((target) => target.wave === 1 && target.state === 'preflight_succeeded')).toBe(true)
  })
})

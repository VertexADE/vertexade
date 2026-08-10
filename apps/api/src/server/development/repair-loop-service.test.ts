import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, repositories, workItems } from '../database/schema/tables.ts'
import { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import { runCommand, runCommandResult } from '../process.ts'
import { CapabilityExecutionService } from '../workflows/capability-execution.ts'
import { registerCoreDevelopmentCapabilities, registerCoreValidationCapabilities } from './capabilities.ts'
import { ImpactAnalysisService } from './impact-service.ts'
import { ValidationRepairLoopService } from './repair-loop-service.ts'
import { ValidationIntelligenceService } from './validation-service.ts'

const directories: string[] = []
const databases: Array<{ close(): void }> = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function git(repository: string, args: string[]): Promise<string> {
  return runCommand('git', args, { cwd: repository, timeoutMs: 10_000, maxOutputBytes: 1_000_000 })
}

describe('bounded validation repair loops', () => {
  it('persists explicit bounds and stops durably when the repair job fails', async () => {
    const path = await mkdtemp(join(tmpdir(), 'vertexade-repair-loop-'))
    directories.push(path)
    await mkdir(join(path, 'src'), { recursive: true })
    await writeFile(join(path, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }))
    await writeFile(join(path, 'src', 'index.js'), 'export const value = 1\n')
    await git(path, ['init', '--initial-branch=main'])
    await git(path, ['add', '.'])
    await git(path, ['-c', 'user.name=VertexADE', '-c', 'user.email=vertexade@example.invalid', 'commit', '-m', 'base'])
    const base = (await git(path, ['rev-parse', 'HEAD'])).trim()
    await writeFile(join(path, 'src', 'index.js'), 'export const value = 2\n')
    await git(path, ['add', '.'])
    await git(path, ['-c', 'user.name=VertexADE', '-c', 'user.email=vertexade@example.invalid', 'commit', '-m', 'head'])
    const head = (await git(path, ['rev-parse', 'HEAD'])).trim()

    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const repositoryId = Number(
      database.insert(repositories).values({ fullName: 'fixture/repository', cloneUrl: path, localPath: path }).run().lastInsertRowid,
    )
    const impact = new ImpactAnalysisService(database, runCommand)
    const analysis = await impact.analyze(await impact.prepareRepositoryComparison(repositoryId, base, head))
    const project = analysis.result.nodes.find((node) => node.kind === 'project' || node.kind === 'package')!
    const validation = new ValidationIntelligenceService(database, impact, runCommandResult)
    validation.replaceOverrides(repositoryId, [
      {
        id: 'fixture:failure',
        projectKey: project.key,
        projectLabel: project.label,
        kind: 'test',
        label: 'Fixture failure',
        script: 'fixture-failure',
        executable: 'node',
        args: ['-e', "console.error('FAIL src/index.js:1:1 expected repair'); process.exit(1)"],
        workingDirectory: '.',
        timeoutMs: 30_000,
        artifactPaths: [],
        enabled: true,
      },
    ])
    const failedRun = await validation.runTarget({ repositoryId, impactAnalysisId: analysis.id, targetId: 'fixture:failure' })
    const registries = new PlatformCapabilityRegistries()
    registerCoreDevelopmentCapabilities(registries, impact)
    registerCoreValidationCapabilities(registries, validation)
    const executions = new CapabilityExecutionService(database, registries)
    const service = new ValidationRepairLoopService(database, impact, validation, executions, async ({ title, prompt }) => {
      const workItemId = Number(
        database.insert(workItems).values({ key: 'W-AUTO-REPAIR', title, state: 'active', primaryRepositoryId: repositoryId }).run()
          .lastInsertRowid,
      )
      const id = Number(
        database
          .insert(jobs)
          .values({
            repoId: repositoryId,
            prNumber: 0,
            prompt,
            worktreePath: path,
            logPath: join(path, 'repair.log'),
            status: 'running',
            headSha: head,
            workItemId,
          })
          .run().lastInsertRowid,
      )
      return { id, work_item_id: workItemId }
    })

    await expect(service.start(failedRun.id, { maxAttempts: 4 })).rejects.toThrow('no greater than 3')
    const loop = await service.start(failedRun.id, { maxAttempts: 2, maxElapsedMinutes: 30 })
    expect(loop).toMatchObject({ state: 'active', attemptCount: 1, maxAttempts: 2, currentRunId: failedRun.id })
    expect(validation.getRun(failedRun.id)?.repairLoop?.id).toBe(loop.id)
    database.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, loop.currentJobId!)).run()
    await service.reconcile()
    expect(service.getByRootRun(failedRun.id)).toMatchObject({ state: 'stopped', stopReason: 'repair_failed' })
  })
})

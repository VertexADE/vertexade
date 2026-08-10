import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, repositories, workItems } from '../database/schema/tables.ts'
import { runCommand, runCommandResult } from '../process.ts'
import { ImpactAnalysisService } from './impact-service.ts'
import { normalizeTestFailures, validationEnvironment, ValidationIntelligenceService } from './validation-service.ts'

const directories: string[] = []
const databases: Array<{ close(): void }> = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function git(repository: string, args: string[]): Promise<string> {
  return runCommand('git', args, { cwd: repository, timeoutMs: 10_000, maxOutputBytes: 1_000_000 })
}

describe('validation intelligence service', () => {
  it('runs at immutable revisions, normalizes failures, and records a base comparison', async () => {
    const path = await mkdtemp(join(tmpdir(), 'vertexade-validation-test-'))
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
    const project = analysis.result.nodes.find((node) => node.kind === 'project' || node.kind === 'package')
    expect(project).toBeTruthy()
    const validation = new ValidationIntelligenceService(database, impact, runCommandResult)
    validation.replaceOverrides(repositoryId, [
      {
        id: 'fixture:failure',
        projectKey: project!.key,
        projectLabel: project!.label,
        kind: 'test',
        label: 'Fixture failure',
        script: 'fixture-failure',
        executable: 'node',
        args: [
          '-e',
          "require('node:fs').writeFileSync('validation-artifact.txt', 'proof'); console.error('FAIL src/index.js:1:1 expected 1 to equal 2'); process.exit(1)",
        ],
        workingDirectory: '.',
        timeoutMs: 30_000,
        artifactPaths: ['validation-artifact.txt', 'missing-artifact.txt'],
        enabled: true,
      },
    ])

    const run = await validation.runTarget({ repositoryId, impactAnalysisId: analysis.id, targetId: 'fixture:failure' })
    expect(run).toMatchObject({ status: 'failed', exitCode: 1, baseComparison: 'failed', freshness: 'unknown' })
    expect(run.failures).toContainEqual(expect.objectContaining({ path: 'src/index.js', line: 1 }))
    expect(run.artifacts).toEqual([
      expect.objectContaining({ path: 'validation-artifact.txt', status: 'captured', kind: 'file', bytes: 5 }),
      { path: 'missing-artifact.txt', status: 'missing', kind: null, bytes: null, modifiedAt: null },
    ])
    expect(validation.runOutput(run.id)?.output).toContain('expected 1 to equal 2')
    expect(validation.repairPrompt(run.id).prompt).toContain('<untrusted_validation_log>')
    const workItemId = Number(
      database
        .insert(workItems)
        .values({ key: 'W-REPAIR', title: 'Repair validation', state: 'active', primaryRepositoryId: repositoryId })
        .run().lastInsertRowid,
    )
    const jobId = Number(
      database
        .insert(jobs)
        .values({
          repoId: repositoryId,
          prNumber: 0,
          prompt: 'repair',
          worktreePath: path,
          logPath: join(path, 'repair.log'),
          status: 'completed',
          headSha: head,
          workItemId,
        })
        .run().lastInsertRowid,
    )
    validation.attachRepair(run.id, { id: jobId, work_item_id: workItemId })
    expect(validation.repairWorkItemReady(run.id)).toBe(workItemId)
  })

  it('keeps only explicitly allowlisted process environment values', () => {
    expect(
      validationEnvironment({
        PATH: '/bin',
        HOME: '/tmp/home',
        SECRET_TOKEN: 'hidden',
        SAFE_VALUE: 'visible',
        VERTEXADE_VALIDATION_ENV_ALLOWLIST: 'SAFE_VALUE',
      }),
    ).toEqual(expect.objectContaining({ PATH: '/bin', HOME: '/tmp/home', SAFE_VALUE: 'visible', CI: '1', NO_COLOR: '1' }))
    expect(validationEnvironment({ SECRET_TOKEN: 'hidden' })).not.toHaveProperty('SECRET_TOKEN')
  })

  it('deduplicates normalized failure fingerprints', () => {
    const failures = normalizeTestFailures('FAIL src/a.test.ts\nError src/a.test.ts:4:2 expected 1\nError src/a.test.ts:4:2 expected 1')
    expect(failures).toHaveLength(2)
    expect(new Set(failures.map((failure) => failure.fingerprint)).size).toBe(2)
  })
})

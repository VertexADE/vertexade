import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { DevelopmentSubject } from '@vertexade/platform-contracts'
import { runCommand } from '../process.ts'
import { analyzeRepositoryImpact, parseGitNameStatus } from './impact-analyzer.ts'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function git(repository: string, args: string[]): Promise<string> {
  return runCommand('git', args, { cwd: repository, timeoutMs: 10_000, maxOutputBytes: 1_000_000 })
}

async function fixtureRepository(): Promise<{ path: string; base: string; head: string }> {
  const path = await mkdtemp(join(tmpdir(), 'vertexade-impact-'))
  directories.push(path)
  await Promise.all([
    mkdir(join(path, 'packages', 'library', 'src', 'api'), { recursive: true }),
    mkdir(join(path, 'apps', 'web', 'src'), { recursive: true }),
    mkdir(join(path, 'apps', 'worker', 'src'), { recursive: true }),
    mkdir(join(path, '.github', 'workflows'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(path, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { check: 'pnpm -r check' } }, null, 2)),
    writeFile(
      join(path, 'packages', 'library', 'package.json'),
      JSON.stringify({ name: '@fixture/library', scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' } }, null, 2),
    ),
    writeFile(
      join(path, 'apps', 'web', 'package.json'),
      JSON.stringify({
        name: '@fixture/web',
        dependencies: { '@fixture/library': 'workspace:*' },
        scripts: { test: 'vitest run', build: 'vite build' },
      }),
    ),
    writeFile(join(path, 'packages', 'library', 'src', 'index.ts'), 'export const value = 1\n'),
    writeFile(join(path, 'packages', 'library', 'src', 'api', 'schema.ts'), 'export type Contract = { value: number }\n'),
    writeFile(join(path, 'apps', 'web', 'src', 'index.ts'), "import { value } from '@fixture/library'\nvoid value\n"),
    writeFile(join(path, 'apps', 'worker', 'package.json'), JSON.stringify({ name: '@fixture/worker', scripts: { test: 'vitest run' } })),
    writeFile(
      join(path, 'apps', 'worker', 'src', 'index.ts'),
      "import { value } from '../../../packages/library/src/index'\nimport type { Contract } from '@fixture/library/api/schema'\nvoid (0 as unknown as Contract)\nvoid value\n",
    ),
    writeFile(join(path, '.github', 'workflows', 'verify.yml'), 'name: Verify\n'),
  ])
  await git(path, ['init', '--initial-branch=main'])
  await git(path, ['add', '.'])
  await git(path, ['-c', 'user.name=VertexADE', '-c', 'user.email=vertexade@example.invalid', 'commit', '-m', 'base'])
  const base = (await git(path, ['rev-parse', 'HEAD'])).trim()
  await Promise.all([
    writeFile(join(path, 'packages', 'library', 'src', 'index.ts'), 'export const value = 2\n'),
    writeFile(join(path, 'packages', 'library', 'src', 'api', 'schema.ts'), 'export type Contract = { value: number; label: string }\n'),
    writeFile(join(path, '.github', 'workflows', 'verify.yml'), 'name: Verify changed\n'),
  ])
  await git(path, ['add', '.'])
  await git(path, ['-c', 'user.name=VertexADE', '-c', 'user.email=vertexade@example.invalid', 'commit', '-m', 'change'])
  return { path, base, head: (await git(path, ['rev-parse', 'HEAD'])).trim() }
}

describe('impact analyzer', () => {
  it('parses modified and renamed paths from null-delimited Git output', () => {
    expect(parseGitNameStatus('M\0src/a.ts\0R100\0src/old.ts\0src/new.ts\0')).toEqual([
      { path: 'src/a.ts', previousPath: null, status: 'modified' },
      { path: 'src/new.ts', previousPath: 'src/old.ts', status: 'renamed' },
    ])
  })

  it('finds direct projects, transitive workspace consumers, validations, contracts, and workflows', async () => {
    const fixture = await fixtureRepository()
    const subject: DevelopmentSubject = {
      kind: 'repository_comparison',
      repositoryId: 1,
      baseRevision: fixture.base,
      headRevision: fixture.head,
    }
    const result = await analyzeRepositoryImpact({
      repository: { id: 1, fullName: 'fixture/repository', localPath: fixture.path },
      subject,
      run: runCommand,
    })

    expect(result.changedFiles.map((file) => file.path)).toEqual([
      '.github/workflows/verify.yml',
      'packages/library/src/api/schema.ts',
      'packages/library/src/index.ts',
    ])
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'project:packages/library', direct: true }),
        expect.objectContaining({ key: 'project:apps/web', direct: false }),
        expect.objectContaining({ key: 'project:apps/worker', direct: false }),
      ]),
    )
    expect(result.edges).toContainEqual(
      expect.objectContaining({ from: 'project:packages/library', to: 'project:apps/web', relation: 'consumed_by' }),
    )
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        from: 'file:packages/library/src/index.ts',
        to: 'file:apps/worker/src/index.ts',
        relation: 'consumed_by',
      }),
    )
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        from: 'file:packages/library/src/api/schema.ts',
        to: 'file:apps/worker/src/index.ts',
        relation: 'consumed_by',
      }),
    )
    expect(result.validationTargets.map((target) => `${target.projectLabel}:${target.script}`)).toEqual(
      expect.arrayContaining([
        '@fixture/library:test',
        '@fixture/library:typecheck',
        '@fixture/web:test',
        '@fixture/web:build',
        '@fixture/worker:test',
      ]),
    )
    expect(result.deliveryEffects).toContainEqual(expect.objectContaining({ kind: 'workflow', path: '.github/workflows/verify.yml' }))
    expect(result.summary).toMatchObject({ directProjects: 2, transitiveProjects: 2, risk: 'high' })
    expect(result.changedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'packages/library/src/index.ts',
          impact: expect.objectContaining({ level: 'high', consumerCount: 2 }),
        }),
      ]),
    )
    expect(result.sourceGraph).toMatchObject({ revision: fixture.head, edgeCount: expect.any(Number) })
    expect(result.summary.contractChanges).toBeGreaterThan(0)
  })
})

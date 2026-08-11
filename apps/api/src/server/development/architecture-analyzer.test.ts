import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { runCommand } from '../process.ts'
import { analyzeRepositoryArchitecture } from './architecture-analyzer.ts'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function git(repository: string, args: string[]): Promise<string> {
  return runCommand('git', args, { cwd: repository, timeoutMs: 10_000, maxOutputBytes: 1_000_000 })
}

async function fixture(): Promise<{ path: string; revision: string }> {
  const path = await mkdtemp(join(tmpdir(), 'vertexade-architecture-'))
  directories.push(path)
  await Promise.all([
    mkdir(join(path, 'apps', 'web'), { recursive: true }),
    mkdir(join(path, 'apps', 'worker', 'src'), { recursive: true }),
    mkdir(join(path, 'packages', 'contracts', 'src'), { recursive: true }),
    mkdir(join(path, 'packages', 'contracts', 'openapi'), { recursive: true }),
    mkdir(join(path, 'docs', 'adrs'), { recursive: true }),
    mkdir(join(path, '.github', 'workflows'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(path, 'package.json'), JSON.stringify({ name: 'fixture', private: true })),
    writeFile(
      join(path, 'packages', 'contracts', 'package.json'),
      JSON.stringify({ name: '@fixture/contracts', exports: { '.': './src/index.ts' } }),
    ),
    writeFile(
      join(path, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: '@fixture/web', dependencies: { '@fixture/contracts': 'workspace:*' } }),
    ),
    writeFile(join(path, 'apps', 'worker', 'package.json'), JSON.stringify({ name: '@fixture/worker' })),
    writeFile(
      join(path, 'apps', 'worker', 'src', 'index.ts'),
      "import { contract } from '../../../packages/contracts/src/index'\nvoid contract\n",
    ),
    writeFile(join(path, 'packages', 'contracts', 'src', 'index.ts'), "export const contract = 'fixture'\n"),
    writeFile(join(path, 'packages', 'contracts', 'openapi', 'service.yaml'), 'openapi: 3.1.0\ninfo:\n  title: Fixture\n'),
    writeFile(join(path, 'docs', 'architecture.md'), '# Fixture architecture\n\nThe web service consumes the shared public contracts.\n'),
    writeFile(
      join(path, 'docs', 'adrs', 'ADR-001-contract-ownership.md'),
      '# ADR-001 Contract ownership\n\nStatus: Accepted\n\nContracts are owned by the contracts package.\n',
    ),
    writeFile(join(path, '.github', 'workflows', 'deploy.yml'), 'name: Deploy\n'),
  ])
  await git(path, ['init', '--initial-branch=main'])
  await git(path, ['add', '.'])
  await git(path, ['-c', 'user.name=VertexADE', '-c', 'user.email=vertexade@example.invalid', 'commit', '-m', 'architecture'])
  return { path, revision: (await git(path, ['rev-parse', 'HEAD'])).trim() }
}

describe('architecture analyzer', () => {
  it('indexes packages, services, contracts, deployments, documents, decisions, and cited dependency edges', async () => {
    const repository = await fixture()
    const result = await analyzeRepositoryArchitecture({
      repository: { id: 1, fullName: 'fixture/repository', localPath: repository.path },
      revision: repository.revision,
      run: runCommand,
    })

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'service', label: '@fixture/web' }),
        expect.objectContaining({ kind: 'package', label: '@fixture/contracts' }),
        expect.objectContaining({ kind: 'api', path: 'packages/contracts/openapi/service.yaml' }),
        expect.objectContaining({ kind: 'deployment', path: '.github/workflows/deploy.yml' }),
        expect.objectContaining({ kind: 'document', label: 'Fixture architecture' }),
      ]),
    )
    expect(result.relations).toContainEqual(
      expect.objectContaining({
        from: 'architecture:service:apps/web',
        to: 'architecture:package:packages/contracts',
        relation: 'depends_on',
        citation: expect.objectContaining({ path: 'apps/web/package.json' }),
      }),
    )
    expect(result.relations).toContainEqual(
      expect.objectContaining({
        from: 'architecture:service:apps/worker',
        to: 'architecture:package:packages/contracts',
        relation: 'depends_on',
        citation: expect.objectContaining({ path: 'apps/worker/src/index.ts', startLine: 1 }),
      }),
    )
    expect(result.relations).toContainEqual(
      expect.objectContaining({
        from: 'architecture:package:packages/contracts',
        relation: 'exposes',
        to: 'architecture:api:packages/contracts/openapi/service.yaml',
      }),
    )
    expect(result.decisions).toContainEqual(
      expect.objectContaining({ id: 'adr-001', title: 'ADR-001 Contract ownership', status: 'accepted' }),
    )
    expect(result.summary).toMatchObject({ packages: 2, services: 2, deployments: 1, decisions: 1 })
    expect(result.summary.contracts).toBeGreaterThanOrEqual(1)
    expect(result.sourceGraph).toMatchObject({ revision: repository.revision, edgeCount: expect.any(Number) })
  })
})

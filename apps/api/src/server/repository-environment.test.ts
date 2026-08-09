import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  inspectRepositoryEnvironmentEntries,
  normalizeRepositoryEnvironmentPaths,
  snapshotRepositoryEnvironment,
} from './repository-environment.ts'

const roots: string[] = []
async function root(name: string) {
  const path = await mkdtemp(join(tmpdir(), name))
  roots.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('repository environment snapshots', () => {
  it('normalizes safe paths and rejects traversal, duplicates, and overlaps', () => {
    expect(normalizeRepositoryEnvironmentPaths(['.env', 'config/local'])).toEqual(['.env', 'config/local'])
    expect(() => normalizeRepositoryEnvironmentPaths(['/tmp/.env'])).toThrow('relative')
    expect(() => normalizeRepositoryEnvironmentPaths(['../.env'])).toThrow('normalized')
    expect(() => normalizeRepositoryEnvironmentPaths(['.env', '.env'])).toThrow('unique')
    expect(() => normalizeRepositoryEnvironmentPaths(['config', 'config/local'])).toThrow('overlap')
    expect(() => normalizeRepositoryEnvironmentPaths(['.git/config'])).toThrow('.git')
  })

  it('inspects regular files and directories', async () => {
    const repository = await root('repository-environment-source-')
    await writeFile(join(repository, '.env'), 'TOKEN=secret\n')
    await mkdir(join(repository, 'config'))
    await writeFile(join(repository, 'config', 'local.json'), '{}')
    await expect(inspectRepositoryEnvironmentEntries(repository, ['.env', 'config'])).resolves.toEqual([
      { relativePath: '.env', kind: 'file' },
      { relativePath: 'config', kind: 'directory' },
    ])
  })

  it('copies files and folders as isolated snapshots', async () => {
    const repository = await root('repository-environment-source-')
    const worktree = await root('repository-environment-worktree-')
    await writeFile(join(repository, '.env'), 'TOKEN=first\n')
    await mkdir(join(repository, 'config'))
    await writeFile(join(repository, 'config', 'local.json'), '{"region":"eu"}')
    const entries = await inspectRepositoryEnvironmentEntries(repository, ['.env', 'config'])
    await snapshotRepositoryEnvironment(repository, worktree, entries)
    await writeFile(join(repository, '.env'), 'TOKEN=second\n')
    await writeFile(join(repository, 'config', 'local.json'), '{"region":"us"}')
    await expect(readFile(join(worktree, '.env'), 'utf8')).resolves.toBe('TOKEN=first\n')
    await expect(readFile(join(worktree, 'config', 'local.json'), 'utf8')).resolves.toBe('{"region":"eu"}')
  })

  it('refuses symbolic links and existing worktree destinations', async () => {
    const repository = await root('repository-environment-source-')
    const worktree = await root('repository-environment-worktree-')
    await writeFile(join(repository, 'secret'), 'value')
    await symlink(join(repository, 'secret'), join(repository, '.env'))
    await expect(inspectRepositoryEnvironmentEntries(repository, ['.env'])).rejects.toThrow('Symbolic links')
    await rm(join(repository, '.env'))
    await writeFile(join(repository, '.env'), 'source')
    await writeFile(join(worktree, '.env'), 'tracked')
    await expect(snapshotRepositoryEnvironment(repository, worktree, [{ relativePath: '.env', kind: 'file' }])).rejects.toThrow(
      'destination already exists',
    )
  })

  it('rejects symbolic links nested inside configured folders before copying anything', async () => {
    const repository = await root('repository-environment-source-')
    const worktree = await root('repository-environment-worktree-')
    await mkdir(join(repository, 'config'))
    await writeFile(join(repository, 'secret'), 'value')
    await symlink(join(repository, 'secret'), join(repository, 'config', 'linked-secret'))
    await expect(snapshotRepositoryEnvironment(repository, worktree, [{ relativePath: 'config', kind: 'directory' }])).rejects.toThrow(
      'Symbolic links',
    )
    await expect(readFile(join(worktree, 'config', 'linked-secret'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})

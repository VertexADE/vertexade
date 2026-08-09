import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase } from './database/dashboard-database.ts'
import { RepositoryEnvironmentProfileService, parseManagedEnv } from './repository-environment-profiles.ts'
import { EncryptedSettingsStore } from './settings/settings-store.ts'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vertexade-environment-'))
  cleanup.push(root)
  await mkdir(join(root, 'apps/api/config'), { recursive: true })
  await writeFile(join(root, '.local-root'), 'root')
  await writeFile(join(root, 'apps/api/config/local.json'), '{"local":true}')
  const database = openDashboardDatabase(':memory:')
  database.$client
    .prepare('INSERT INTO repositories (full_name,clone_url,local_path) VALUES (?,?,?)')
    .run('vertexade/platform', 'git@example.test:vertexade/platform.git', root)
  const repository = database.$client.prepare('SELECT * FROM repositories').get() as any
  const run = vi.fn(async () => '')
  const service = new RepositoryEnvironmentProfileService(database, new EncryptedSettingsStore(database, randomBytes(32)), run)
  return { database, repository, root, run, service }
}

describe('repository environment profiles', () => {
  it('parses standard dotenv groups and reports malformed lines', () => {
    expect(parseManagedEnv('A=one\nB=\'two words\'\nexport C="line\\nnext"\nD=value # note')).toEqual({
      A: 'one',
      B: 'two words',
      C: 'line\nnext',
      D: 'value',
    })
    expect(() => parseManagedEnv('not-an-assignment')).toThrow('line 1')
  })

  it('inherits encrypted values and preserves secrets that are not replaced', async () => {
    const { repository, service } = await fixture()
    await service.replace(repository, [
      {
        scope: '',
        snapshotPaths: ['.local-root'],
        variables: [
          { name: 'SHARED', value: 'root' },
          { name: 'ROOT_ONLY', value: 'yes' },
        ],
        envFiles: [{ path: '.env', content: 'FROM_FILE=root\nOVERRIDE=file' }],
        startCommand: 'npm run dev -- --domain {{domain}}',
      },
      {
        scope: 'apps/api',
        snapshotPaths: ['config/local.json'],
        variables: [
          { name: 'SHARED', value: 'api' },
          { name: 'OVERRIDE', value: 'variable' },
        ],
        envFiles: [{ path: '.env.local', content: 'API_FILE=true' }],
        stopCommand: 'npm run cleanup',
      },
    ])

    expect(service.list(repository.id)).toEqual([
      expect.objectContaining({
        scope: '',
        variables: [
          { name: 'ROOT_ONLY', configured: true },
          { name: 'SHARED', configured: true },
        ],
        envFiles: [{ path: '.env', configured: true }],
      }),
      expect.objectContaining({
        scope: 'apps/api',
        inheritsFrom: [''],
        variables: [
          { name: 'OVERRIDE', configured: true },
          { name: 'SHARED', configured: true },
        ],
      }),
    ])
    expect(service.resolve(repository.id, 'apps/api/src')).toEqual({
      repository: 'vertexade/platform',
      scope: 'apps/api',
      variables: {
        FROM_FILE: 'root',
        OVERRIDE: 'variable',
        ROOT_ONLY: 'yes',
        SHARED: 'api',
        API_FILE: 'true',
      },
      startCommand: 'npm run dev -- --domain {{domain}}',
      stopCommand: 'npm run cleanup',
    })

    const current = service.list(repository.id)
    await service.replace(
      repository,
      current.map((profile) => ({
        ...profile,
        snapshotPaths: profile.snapshotPaths,
      })),
    )
    expect(service.resolve(repository.id, 'apps/api').variables.SHARED).toBe('api')
  })

  it('copies scoped snapshots to their repository-relative worktree destinations', async () => {
    const { repository, root, service } = await fixture()
    await service.replace(repository, [
      { scope: '', snapshotPaths: ['.local-root'] },
      { scope: 'apps/api', snapshotPaths: ['config/local.json'] },
    ])
    const worktree = join(root, 'worktree')
    await mkdir(join(worktree, 'apps/api/config'), { recursive: true })
    await service.prepareWorktree(repository, worktree)
    await expect(readFile(join(worktree, '.local-root'), 'utf8')).resolves.toBe('root')
    await expect(readFile(join(worktree, 'apps/api/config/local.json'), 'utf8')).resolves.toBe('{"local":true}')
  })

  it('rejects tracked snapshot files', async () => {
    const { repository, run, service } = await fixture()
    run.mockResolvedValueOnce('.local-root')
    await expect(service.replace(repository, [{ scope: '', snapshotPaths: ['.local-root'] }])).rejects.toThrow('tracked by Git')
  })
})

import { createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { encryptSettings } from '../apps/api/src/encrypted-settings.ts'
import { openDashboardDatabase } from '../apps/api/src/server/database/dashboard-database.ts'
import { encryptedSettings } from '../apps/api/src/server/database/schema/tables.ts'

const runFile = promisify(execFile)
const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const temporaryDirectories: string[] = []

async function digest(path: string) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

async function backupFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'vertexade-backup-test-'))
  temporaryDirectories.push(directory)
  const databasePath = join(directory, 'dashboard.sqlite')
  const keyPath = join(directory, 'settings.key')
  const key = randomBytes(32)
  await writeFile(keyPath, key)
  const database = openDashboardDatabase(databasePath)
  database
    .insert(encryptedSettings)
    .values({ name: 'github', payload: encryptSettings({ token: 'secret' }, key) })
    .run()
  database.close()
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      source: { settingsKey: '/production/data/settings.key' },
      files: [
        { name: 'dashboard.sqlite', sha256: await digest(databasePath) },
        { name: 'settings.key', sha256: await digest(keyPath) },
      ],
    }),
  )
  return { directory, keyPath }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('verified backup restore drill', () => {
  it('restores the database/key pair and proves settings compatibility', async () => {
    const { directory } = await backupFixture()
    const result = await runFile(process.execPath, [join(root, 'scripts/backup-verified.mjs'), '--restore-drill', directory], {
      cwd: root,
    })
    expect(result.stdout).toContain('Restored state ready at schema')
    expect(result.stdout).toContain('decrypted 1 settings row(s)')
    expect(result.stdout).toContain('Restore drill passed')
  })

  it('rejects a cryptographically valid backup whose key cannot decrypt its settings', async () => {
    const { directory, keyPath } = await backupFixture()
    await writeFile(keyPath, randomBytes(32))
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    manifest.files.find((file: { name: string }) => file.name === 'settings.key').sha256 = await digest(keyPath)
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))

    await expect(
      runFile(process.execPath, [join(root, 'scripts/backup-verified.mjs'), '--restore-drill', directory], { cwd: root }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('Encrypted setting github could not be decrypted') })
  })
})

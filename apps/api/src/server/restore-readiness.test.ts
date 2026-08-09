import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { encryptSettings } from '../encrypted-settings.ts'
import { dashboardSchemaVersion, openDashboardDatabase } from './database/dashboard-database.ts'
import { encryptedSettings } from './database/schema/tables.ts'
import { verifyRestoredDashboardState } from './restore-readiness.ts'

const temporaryDirectories: string[] = []

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'vertexade-restore-readiness-'))
  temporaryDirectories.push(directory)
  const databasePath = join(directory, 'dashboard.sqlite')
  const keyPath = join(directory, 'settings.key')
  const key = randomBytes(32)
  await writeFile(keyPath, key, { mode: 0o600 })
  const database = openDashboardDatabase(databasePath)
  database.close()
  return { databasePath, keyPath, key }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('restored dashboard readiness', () => {
  it('opens the real schema and decrypts every restored settings row', async () => {
    const { databasePath, keyPath, key } = await fixture()
    const database = openDashboardDatabase(databasePath)
    database
      .insert(encryptedSettings)
      .values({ name: 'github', payload: encryptSettings({ token: 'secret' }, key) })
      .run()
    database.close()

    await expect(verifyRestoredDashboardState(databasePath, keyPath)).resolves.toMatchObject({
      ready: true,
      schemaVersion: dashboardSchemaVersion,
      encryptedSettings: 1,
    })
  })

  it('accepts an empty settings table while still requiring a valid key', async () => {
    const { databasePath, keyPath } = await fixture()
    await expect(verifyRestoredDashboardState(databasePath, keyPath)).resolves.toMatchObject({ encryptedSettings: 0 })
  })

  it('fails safely for a missing, malformed, or incompatible key', async () => {
    const { databasePath, keyPath, key } = await fixture()
    const database = openDashboardDatabase(databasePath)
    database
      .insert(encryptedSettings)
      .values({ name: 'github', payload: encryptSettings({ token: 'secret' }, key) })
      .run()
    database.close()

    await expect(verifyRestoredDashboardState(databasePath, `${keyPath}.missing`)).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(keyPath, randomBytes(16))
    await expect(verifyRestoredDashboardState(databasePath, keyPath)).rejects.toThrow('exactly 32 bytes')
    await writeFile(keyPath, randomBytes(32))
    await expect(verifyRestoredDashboardState(databasePath, keyPath)).rejects.toThrow('Encrypted setting github could not be decrypted')
  })

  it('repairs restored key permissions to the production mode', async () => {
    const { databasePath, keyPath } = await fixture()
    await chmod(keyPath, 0o644)
    await verifyRestoredDashboardState(databasePath, keyPath)
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600)
  })
})

import { readExistingEncryptionKey } from '../encrypted-settings.ts'
import { dashboardSchemaVersion, openDashboardDatabase } from './database/dashboard-database.ts'
import { appSettings, repositories, workItems } from './database/schema/tables.ts'
import { EncryptedSettingsStore, JsonSettingsStore } from './settings/settings-store.ts'
import { count, sql } from 'drizzle-orm'

export type RestoreReadiness = {
  ready: true
  schemaVersion: number
  encryptedSettings: number
  repositories: number
  workItems: number
  appSettings: number
}

export async function verifyRestoredDashboardState(databasePath: string, keyPath: string): Promise<RestoreReadiness> {
  const key = await readExistingEncryptionKey(keyPath)
  const database = openDashboardDatabase(databasePath)
  try {
    const integrity = database.$client
      .prepare('PRAGMA integrity_check')
      .all()
      .map((row) => String(Object.values(row)[0]))
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity.join(', ')}`)

    const schemaVersion = Number(database.$client.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version || 0)
    if (schemaVersion !== dashboardSchemaVersion)
      throw new Error(`Restored schema version ${schemaVersion} does not match expected version ${dashboardSchemaVersion}`)

    database.$client.exec('BEGIN IMMEDIATE; CREATE TABLE restore_readiness_probe (id INTEGER PRIMARY KEY); ROLLBACK')

    const encrypted = new EncryptedSettingsStore(database, key).verifyAll()
    const jsonSettings = new JsonSettingsStore(database)
    jsonSettings.read('__restore_readiness_missing__', null)

    return {
      ready: true,
      schemaVersion,
      encryptedSettings: encrypted.length,
      repositories: Number(database.select({ value: count() }).from(repositories).get()?.value || 0),
      workItems: Number(database.select({ value: count() }).from(workItems).get()?.value || 0),
      appSettings: Number(
        database
          .select({ value: sql<number>`count(*)` })
          .from(appSettings)
          .get()?.value || 0,
      ),
    }
  } finally {
    database.close()
  }
}

import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { appSettings, encryptedSettings } from '../database/schema/tables.ts'
import { decryptSettings, encryptSettings } from '../../encrypted-settings.ts'
import { asc, eq, sql } from 'drizzle-orm'

export type SettingsStore = {
  read<T>(name: string, fallback: T): T
  write(name: string, value: unknown): void
  delete(name: string): void
  has(name: string): boolean
}

export class EncryptedSettingsStore implements SettingsStore {
  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly key: Buffer,
  ) {}

  read<T>(name: string, fallback: T): T {
    const row = this.database
      .select({ payload: encryptedSettings.payload })
      .from(encryptedSettings)
      .where(eq(encryptedSettings.name, name))
      .get()
    return row ? (decryptSettings(row.payload, this.key) as T) : fallback
  }

  write(name: string, value: unknown) {
    this.database
      .insert(encryptedSettings)
      .values({ name, payload: encryptSettings(value, this.key) })
      .onConflictDoUpdate({
        target: encryptedSettings.name,
        set: { payload: sql`excluded.payload`, updatedAt: sql`CURRENT_TIMESTAMP` },
      })
      .run()
  }

  delete(name: string) {
    this.database.delete(encryptedSettings).where(eq(encryptedSettings.name, name)).run()
  }

  has(name: string) {
    return Boolean(
      this.database.select({ name: encryptedSettings.name }).from(encryptedSettings).where(eq(encryptedSettings.name, name)).get(),
    )
  }

  verifyAll() {
    const rows = this.database
      .select({ name: encryptedSettings.name, payload: encryptedSettings.payload })
      .from(encryptedSettings)
      .orderBy(asc(encryptedSettings.name))
      .all()
    for (const row of rows) {
      try {
        decryptSettings(row.payload, this.key)
      } catch (error) {
        throw new Error(`Encrypted setting ${row.name} could not be decrypted`, { cause: error })
      }
    }
    return rows.map((row) => row.name)
  }
}

export class JsonSettingsStore {
  constructor(private readonly database: DrizzleDashboardDatabase) {}

  read<T>(name: string, fallback: T): T {
    const row = this.database.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.name, name)).get()
    if (!row) return fallback
    try {
      return JSON.parse(String(row.value)) as T
    } catch {
      return fallback
    }
  }

  write(name: string, value: unknown) {
    this.database
      .insert(appSettings)
      .values({ name, value: JSON.stringify(value) })
      .onConflictDoUpdate({
        target: appSettings.name,
        set: { value: sql`excluded.value`, updatedAt: sql`CURRENT_TIMESTAMP` },
      })
      .run()
  }

  delete(name: string) {
    this.database.delete(appSettings).where(eq(appSettings.name, name)).run()
  }
}

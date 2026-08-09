import { asc, eq } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { extensionMigrations } from '../database/schema/tables.ts'

export function createExtensionMigrationStore(database: DrizzleDashboardDatabase) {
  return {
    applied: (moduleId: string) =>
      database
        .select({ version: extensionMigrations.version })
        .from(extensionMigrations)
        .where(eq(extensionMigrations.moduleId, moduleId))
        .orderBy(asc(extensionMigrations.version))
        .all()
        .map(({ version }) => version),
    record: (moduleId: string, version: number, name: string) => {
      database.insert(extensionMigrations).values({ moduleId, version, name }).run()
    },
  }
}

import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { relations } from './schema/relations.ts'
import { migrateDashboardDatabase } from './migrations.ts'

export { dashboardSchemaVersion, migrateDashboardDatabase } from './migrations.ts'

export function drizzleDashboardDatabase(client: DatabaseSync) {
  const database = drizzle({ client, relations })
  return Object.assign(database, {
    close: client.close.bind(client),
  })
}

export type DrizzleDashboardDatabase = ReturnType<typeof drizzleDashboardDatabase>

export function openDashboardDatabase(path: string): DrizzleDashboardDatabase {
  const client = new DatabaseSync(path)
  migrateDashboardDatabase(client)
  return drizzleDashboardDatabase(client)
}

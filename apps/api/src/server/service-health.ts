import { max } from 'drizzle-orm'
import { dashboardSchemaVersion, type DrizzleDashboardDatabase } from './database/dashboard-database.ts'
import { automationRuntimeControl, schemaMigrations } from './database/schema/tables.ts'

export function liveness(uptimeSeconds = Math.round(process.uptime())) {
  return { status: 'ok' as const, uptimeSeconds }
}

export function readiness(database: DrizzleDashboardDatabase, expectedSchemaVersion = dashboardSchemaVersion) {
  try {
    const migration = database
      .select({ version: max(schemaMigrations.version) })
      .from(schemaMigrations)
      .get()
    const schemaVersion = Number(migration?.version || 0)
    database.select({ id: automationRuntimeControl.id }).from(automationRuntimeControl).limit(1).get()
    if (schemaVersion < expectedSchemaVersion) {
      return {
        ready: false as const,
        status: 'schema-outdated' as const,
        schemaVersion,
        expectedSchemaVersion,
      }
    }
    return { ready: true as const, status: 'ready' as const, schemaVersion, expectedSchemaVersion }
  } catch {
    return {
      ready: false as const,
      status: 'database-unavailable' as const,
      schemaVersion: null,
      expectedSchemaVersion,
    }
  }
}

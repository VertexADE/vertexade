import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { dashboardSchemaVersion, drizzleDashboardDatabase, openDashboardDatabase } from './database/dashboard-database.ts'
import { liveness, readiness } from './service-health.ts'

const databases: Array<{ close(): void }> = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('service health', () => {
  it('reports lightweight process liveness', () => {
    expect(liveness(42)).toEqual({ status: 'ok', uptimeSeconds: 42 })
  })

  it('reports a migrated database as ready', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    expect(readiness(database)).toEqual({
      ready: true,
      status: 'ready',
      schemaVersion: dashboardSchemaVersion,
      expectedSchemaVersion: dashboardSchemaVersion,
    })
  })

  it('fails readiness when storage is unavailable or outdated', () => {
    const unavailable = new DatabaseSync(':memory:')
    databases.push(unavailable)
    expect(readiness(drizzleDashboardDatabase(unavailable), 13)).toMatchObject({
      ready: false,
      status: 'database-unavailable',
    })

    const outdated = new DatabaseSync(':memory:')
    databases.push(outdated)
    outdated.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (12);
      CREATE TABLE automation_runtime_control (id INTEGER PRIMARY KEY);
      INSERT INTO automation_runtime_control (id) VALUES (1);`)
    expect(readiness(drizzleDashboardDatabase(outdated), 13)).toEqual({
      ready: false,
      status: 'schema-outdated',
      schemaVersion: 12,
      expectedSchemaVersion: 13,
    })
  })
})

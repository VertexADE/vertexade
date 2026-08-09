import { sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'

export function createJobLogQuery(database: DrizzleDashboardDatabase) {
  const columns = database
    .all<{ name: string }>(sql.raw("SELECT name FROM pragma_table_info('jobs') WHERE name <> 'latest_diff'"))
    .map(({ name }) => String(name))
    .filter((name) => name !== 'subagent_token_hash' && /^[a-z][a-z0-9_]*$/i.test(name))
    .map((name) => `j."${name}"`)
    .join(',')
  return {
    get(jobId: number) {
      return database.get(
        sql`SELECT ${sql.raw(columns)}, r.full_name FROM jobs j JOIN repositories r ON r.id=j.repo_id WHERE j.id = ${jobId}`,
      )
    },
  }
}

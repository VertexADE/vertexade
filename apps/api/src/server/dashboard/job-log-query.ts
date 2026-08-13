import { sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'

export function createJobLogQuery(database: DrizzleDashboardDatabase) {
  const columns = database
    .all<{ name: string }>(sql.raw("SELECT name FROM pragma_table_info('jobs') WHERE name <> 'latest_diff'"))
    .map(({ name }) => String(name))
    .filter((name) => !['subagent_token_hash', 'task_title'].includes(name) && /^[a-z][a-z0-9_]*$/i.test(name))
    .map((name) => `j."${name}"`)
    .join(',')
  return {
    get(jobId: number) {
      return database.get(
        sql`SELECT ${sql.raw(columns)},
          COALESCE(j.task_title, CASE WHEN j.kind='review' AND p.title IS NOT NULL THEN 'Review PR #' || j.pr_number || ': ' || p.title END) AS task_title,
          r.full_name
          FROM jobs j JOIN repositories r ON r.id=j.repo_id
          LEFT JOIN pull_requests p ON p.repo_id=j.repo_id AND p.number=j.pr_number
          WHERE j.id = ${jobId}`,
      )
    },
  }
}

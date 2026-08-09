import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

function timestamps() {
  return {
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }
}

function cleanupState() {
  return {
    state: text().default('pending').notNull(),
    attempts: integer().default(0).notNull(),
    nextRetryAt: text('next_retry_at'),
    lastError: text('last_error'),
    ...timestamps(),
    completedAt: text('completed_at'),
  }
}

export const extensionStates = sqliteTable('extension_states', {
  moduleId: text('module_id').primaryKey(),
  desiredEnabled: integer('desired_enabled', { mode: 'boolean' }).notNull(),
  appliedEnabled: integer('applied_enabled', { mode: 'boolean' }).notNull(),
  phase: text().default('stable').notNull(),
  operationId: text('operation_id'),
  attempts: integer().default(0).notNull(),
  lastError: text('last_error'),
  ...timestamps(),
})

export const workCleanupTombstones = sqliteTable(
  'work_cleanup_tombstones',
  {
    id: integer().primaryKey(),
    workItemId: integer('work_item_id').notNull(),
    workKey: text('work_key').notNull(),
    workTitle: text('work_title').notNull(),
    ...cleanupState(),
  },
  (table) => [index('work_cleanup_tombstones_due').on(table.state, table.nextRetryAt)],
)

export const workCleanupArtifacts = sqliteTable(
  'work_cleanup_artifacts',
  {
    id: integer().primaryKey(),
    tombstoneId: integer('tombstone_id')
      .notNull()
      .references(() => workCleanupTombstones.id, { onDelete: 'cascade' }),
    identity: text().notNull(),
    jobId: integer('job_id'),
    kind: text().notNull(),
    target: text().notNull(),
    metadata: text({ mode: 'json' }).$type<Record<string, unknown>>().default({}).notNull(),
    ...cleanupState(),
  },
  (table) => [
    unique('work_cleanup_artifacts_identity').on(table.tombstoneId, table.identity),
    index('work_cleanup_artifacts_due').on(table.state, table.nextRetryAt),
  ],
)

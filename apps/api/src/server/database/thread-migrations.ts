import { addColumn, columns } from './migration-utils.ts'
import type { Migration } from './migration.ts'

export const threadMigrations: Migration[] = [
  {
    version: 48,
    name: 'thread-settle-and-snooze',
    migrate(database) {
      const jobColumns = columns(database, 'jobs')
      addColumn(database, 'jobs', jobColumns, 'settled_at', 'TEXT')
      addColumn(database, 'jobs', jobColumns, 'snoozed_until', 'TEXT')
    },
  },
  {
    version: 49,
    name: 'thread-turn-started-at',
    migrate(database) {
      const jobColumns = columns(database, 'jobs')
      addColumn(database, 'jobs', jobColumns, 'turn_started_at', 'TEXT')
    },
  },
]

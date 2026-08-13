import type { DatabaseSync } from 'node:sqlite'
import { addColumn, columns } from './migration-utils.ts'

export const localDirectoryMigration = {
  version: 45,
  name: 'local-directory-workspaces',
  migrate(database: DatabaseSync) {
    const existing = columns(database, 'repositories')
    addColumn(database, 'repositories', existing, 'source_kind', "TEXT NOT NULL DEFAULT 'git'")
    addColumn(database, 'repositories', existing, 'workspace_strategy', "TEXT NOT NULL DEFAULT 'worktree'")
  },
}

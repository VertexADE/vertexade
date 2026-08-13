import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { vertexWorkItemDirectory } from '@vertexade/platform-server/configuration'
import { eq } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { repositories as repositoriesTable } from '../database/schema/tables.ts'

export function generalWorkspaceRepository(db: DrizzleDashboardDatabase) {
  const fullName = 'Workspace/General'
  const localPath = join(vertexWorkItemDirectory(), '.general-template')
  mkdirSync(localPath, { recursive: true })
  db.insert(repositoriesTable)
    .values({ fullName, cloneUrl: localPath, localPath, sourceKind: 'workspace', workspaceStrategy: 'copy' })
    .onConflictDoNothing()
    .run()
  const row = db
    .select({
      id: repositoriesTable.id,
      full_name: repositoriesTable.fullName,
      clone_url: repositoriesTable.cloneUrl,
      local_path: repositoriesTable.localPath,
      created_at: repositoriesTable.createdAt,
      synced_at: repositoriesTable.syncedAt,
      source_kind: repositoriesTable.sourceKind,
      workspace_strategy: repositoriesTable.workspaceStrategy,
    })
    .from(repositoriesTable)
    .where(eq(repositoriesTable.fullName, fullName))
    .get()
  if (!row) throw new Error('Could not create the general workspace')
  return row
}

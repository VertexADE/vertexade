import type { Migration } from './migration.ts'

export const agentResourceOverridesMigration: Migration = {
  version: 50,
  name: 'work-agent-resource-overrides',
  migrate(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS work_agent_resource_overrides (
        work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        resource_kind TEXT NOT NULL CHECK(resource_kind IN ('skill','mcp')),
        resource_id TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(work_item_id,resource_kind,resource_id)
      );
      CREATE INDEX IF NOT EXISTS work_agent_resource_overrides_item
        ON work_agent_resource_overrides(work_item_id,resource_kind);
    `)
  },
}

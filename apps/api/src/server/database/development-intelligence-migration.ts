import type { Migration } from './migration.ts'

export const developmentIntelligenceMigration: Migration = {
  version: 42,
  name: 'development-repository-knowledge',
  migrate(database) {
    database.exec(`
      CREATE TABLE repository_knowledge_entries (
        id INTEGER PRIMARY KEY,
        repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('fact','decision','constraint','risk','pattern','ownership')),
        scope TEXT NOT NULL CHECK(scope IN ('repository','path','boundary')),
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        path TEXT,
        boundary_key TEXT,
        confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
        status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','superseded','archived')),
        source_artifact_kind TEXT NOT NULL CHECK(source_artifact_kind IN ('impact_analysis','architecture_index')),
        source_artifact_id INTEGER NOT NULL,
        source_revision TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        source_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        source_work_item_id INTEGER REFERENCES work_items(id) ON DELETE SET NULL,
        supersedes_entry_id INTEGER REFERENCES repository_knowledge_entries(id) ON DELETE SET NULL,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT
      );
      CREATE INDEX repository_knowledge_repository_status
        ON repository_knowledge_entries(repository_id, status, updated_at DESC, id DESC);
      CREATE INDEX repository_knowledge_artifact
        ON repository_knowledge_entries(repository_id, source_artifact_kind, source_artifact_id, created_at DESC);
      CREATE INDEX repository_knowledge_source_job ON repository_knowledge_entries(source_job_id);
    `)
  },
}

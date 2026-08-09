type SqliteExecutor = {
  exec(sql: string): void
  prepare(sql: string): { all(): Array<Record<string, unknown>> }
}

type DrizzleSqliteExecutor = { $client: SqliteExecutor }

/**
 * Baseline for installations created before Work was folded into the dashboard
 * migration sequence. Runtime services must not own or mutate this schema.
 */
export function ensureWorkSchema(database: SqliteExecutor | DrizzleSqliteExecutor) {
  const nativeDatabase = '$client' in database ? database.$client : database
  nativeDatabase.exec(`
    CREATE TABLE IF NOT EXISTS work_items (
      id INTEGER PRIMARY KEY,
      key TEXT UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'implementation' CHECK(kind IN ('implementation','pr_review','investigation','operational')),
      state TEXT NOT NULL DEFAULT 'backlog' CHECK(state IN ('backlog','active','review','deploy','done')),
      state_override TEXT CHECK(state_override IS NULL OR state_override IN ('backlog','active','review','deploy','done')),
      state_override_reason TEXT,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
      owner TEXT,
      primary_repository_id INTEGER REFERENCES repositories(id) ON DELETE SET NULL,
      attention TEXT,
      sequential_execution INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS work_resources (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      external_id TEXT NOT NULL,
      repository_id INTEGER REFERENCES repositories(id) ON DELETE SET NULL,
      label TEXT NOT NULL,
      url TEXT,
      state TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, kind, external_id)
    );
    CREATE TABLE IF NOT EXISTS work_item_resources (
      work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      resource_id INTEGER NOT NULL REFERENCES work_resources(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(work_item_id, resource_id, role)
    );
    CREATE TABLE IF NOT EXISTS work_item_relations (
      from_work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      to_work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      relation TEXT NOT NULL CHECK(relation IN ('parent','child','blocks','blocked_by','related','duplicate')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(from_work_item_id, to_work_item_id, relation),
      CHECK(from_work_item_id <> to_work_item_id)
    );
    CREATE TABLE IF NOT EXISTS work_events (
      id INTEGER PRIMARY KEY,
      work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'system',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS work_context_transfers (
      id INTEGER PRIMARY KEY,
      work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      source_work_item_id INTEGER REFERENCES work_items(id) ON DELETE SET NULL,
      destination_work_item_id INTEGER REFERENCES work_items(id) ON DELETE SET NULL,
      source_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      destination_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
      instruction TEXT NOT NULL,
      context_snapshot TEXT NOT NULL,
      output_snapshot TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS work_items_state ON work_items(state, updated_at DESC);
    CREATE INDEX IF NOT EXISTS work_resources_identity ON work_resources(provider, kind, external_id);
    CREATE INDEX IF NOT EXISTS work_item_resources_item ON work_item_resources(work_item_id);
    CREATE INDEX IF NOT EXISTS work_events_item ON work_events(work_item_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS work_context_transfers_item ON work_context_transfers(work_item_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS work_context_transfers_destination ON work_context_transfers(destination_job_id, status);
  `)
  const jobColumns = new Set(
    nativeDatabase
      .prepare('PRAGMA table_info(jobs)')
      .all()
      .map((column) => String(column.name)),
  )
  if (!jobColumns.has('work_item_id')) nativeDatabase.exec('ALTER TABLE jobs ADD COLUMN work_item_id INTEGER REFERENCES work_items(id)')
  if (!jobColumns.has('worktree_removed_at')) nativeDatabase.exec('ALTER TABLE jobs ADD COLUMN worktree_removed_at TEXT')
  if (!jobColumns.has('session_cwd')) nativeDatabase.exec('ALTER TABLE jobs ADD COLUMN session_cwd TEXT')
  if (!jobColumns.has('workspace_mode')) {
    nativeDatabase.exec("ALTER TABLE jobs ADD COLUMN workspace_mode TEXT NOT NULL DEFAULT 'combined'")
  }
}

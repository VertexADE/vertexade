import type { Migration } from './migrations.ts'

export const developmentMigrations: Migration[] = [
  {
    version: 33,
    name: 'development-impact-analyses',
    migrate(database) {
      database.exec(`
        CREATE TABLE impact_analyses (
          id INTEGER PRIMARY KEY,
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          subject_kind TEXT NOT NULL CHECK(subject_kind IN ('repository_comparison','pull_request','work_item','migration_target')),
          pull_request_number INTEGER,
          work_item_id INTEGER REFERENCES work_items(id) ON DELETE SET NULL,
          job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
          base_revision TEXT NOT NULL,
          head_revision TEXT NOT NULL,
          analyzer_version TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('succeeded','failed','cancelled','timed-out')),
          execution_id INTEGER REFERENCES capability_executions(id) ON DELETE SET NULL,
          result TEXT NOT NULL,
          digest TEXT NOT NULL,
          warning_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at TEXT
        );
        CREATE INDEX impact_analyses_repository_recent ON impact_analyses(repository_id, created_at DESC, id DESC);
        CREATE INDEX impact_analyses_pull_request ON impact_analyses(repository_id, pull_request_number, head_revision);
        CREATE UNIQUE INDEX impact_analyses_revision
          ON impact_analyses(repository_id, subject_kind, base_revision, head_revision, analyzer_version);
      `)
    },
  },
  {
    version: 34,
    name: 'development-architecture-context',
    migrate(database) {
      database.exec(`
        CREATE TABLE architecture_indexes (
          id INTEGER PRIMARY KEY,
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          revision TEXT NOT NULL,
          index_version TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('succeeded','failed','cancelled','timed-out')),
          execution_id INTEGER REFERENCES capability_executions(id) ON DELETE SET NULL,
          result TEXT NOT NULL,
          digest TEXT NOT NULL,
          warning_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at TEXT
        );
        CREATE INDEX architecture_indexes_repository_recent ON architecture_indexes(repository_id, created_at DESC, id DESC);
        CREATE UNIQUE INDEX architecture_indexes_revision ON architecture_indexes(repository_id, revision, index_version);

        CREATE TABLE architecture_context_packets (
          id INTEGER PRIMARY KEY,
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          index_id INTEGER NOT NULL REFERENCES architecture_indexes(id) ON DELETE CASCADE,
          subject_kind TEXT NOT NULL,
          subject_key TEXT NOT NULL,
          revision TEXT NOT NULL,
          subject TEXT NOT NULL,
          packet TEXT NOT NULL,
          digest TEXT NOT NULL,
          byte_budget INTEGER NOT NULL,
          estimated_bytes INTEGER NOT NULL,
          truncated INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX architecture_context_packets_subject
          ON architecture_context_packets(repository_id, subject_kind, subject_key, created_at DESC);
        CREATE UNIQUE INDEX architecture_context_packets_digest
          ON architecture_context_packets(index_id, subject_kind, subject_key, byte_budget, digest);
      `)
    },
  },
  {
    version: 35,
    name: 'development-test-intelligence',
    migrate(database) {
      database.exec(`
        CREATE TABLE repository_test_targets (
          id INTEGER PRIMARY KEY,
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          target_id TEXT NOT NULL,
          project_key TEXT NOT NULL,
          project_label TEXT NOT NULL,
          kind TEXT NOT NULL,
          label TEXT NOT NULL,
          script TEXT NOT NULL,
          executable TEXT NOT NULL CHECK(executable IN ('pnpm','npm','yarn','bun','node')),
          args TEXT NOT NULL,
          working_directory TEXT NOT NULL DEFAULT '.',
          timeout_ms INTEGER NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX repository_test_targets_identity ON repository_test_targets(repository_id, target_id);

        CREATE TABLE validation_runs (
          id INTEGER PRIMARY KEY,
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          impact_analysis_id INTEGER NOT NULL REFERENCES impact_analyses(id) ON DELETE CASCADE,
          subject_kind TEXT NOT NULL,
          pull_request_number INTEGER,
          base_revision TEXT NOT NULL,
          head_revision TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running','passed','failed','cancelled','timed-out')),
          execution_id INTEGER REFERENCES capability_executions(id) ON DELETE SET NULL,
          exit_code INTEGER,
          duration_ms INTEGER,
          output TEXT NOT NULL DEFAULT '',
          output_bytes INTEGER NOT NULL DEFAULT 0,
          output_truncated INTEGER NOT NULL DEFAULT 0,
          failures TEXT NOT NULL DEFAULT '[]',
          digest TEXT,
          base_comparison TEXT NOT NULL DEFAULT 'not_run',
          repair_work_item_id INTEGER REFERENCES work_items(id) ON DELETE SET NULL,
          repair_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          finished_at TEXT
        );
        CREATE INDEX validation_runs_repository_recent ON validation_runs(repository_id, created_at DESC, id DESC);
        CREATE INDEX validation_runs_pull_request ON validation_runs(repository_id, pull_request_number, head_revision);
        CREATE INDEX validation_runs_impact_target ON validation_runs(impact_analysis_id, target_id, created_at DESC);
      `)
    },
  },
  {
    version: 36,
    name: 'development-pull-request-evidence',
    migrate(database) {
      database.exec(`
        CREATE TABLE pull_request_evidence_policies (
          repository_id INTEGER PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
          version INTEGER NOT NULL DEFAULT 1,
          rules TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE pull_request_evidence_snapshots (
          id INTEGER PRIMARY KEY,
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          pull_request_number INTEGER NOT NULL,
          head_revision TEXT NOT NULL,
          policy_version INTEGER NOT NULL,
          readiness TEXT NOT NULL CHECK(readiness IN ('ready','blocked','unknown','stale')),
          entries TEXT NOT NULL,
          counts TEXT NOT NULL,
          digest TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX pull_request_evidence_snapshots_pull
          ON pull_request_evidence_snapshots(repository_id, pull_request_number, id DESC);
        CREATE UNIQUE INDEX pull_request_evidence_snapshots_digest
          ON pull_request_evidence_snapshots(repository_id, pull_request_number, head_revision, policy_version, digest);

        CREATE TABLE pull_request_evidence_waivers (
          id INTEGER PRIMARY KEY,
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          pull_request_number INTEGER NOT NULL,
          head_revision TEXT NOT NULL,
          entry_key TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT NOT NULL,
          expires_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          revoked_at TEXT
        );
        CREATE INDEX pull_request_evidence_waivers_pull
          ON pull_request_evidence_waivers(repository_id, pull_request_number, head_revision);
      `)
    },
  },
  {
    version: 37,
    name: 'development-migration-campaigns',
    migrate(database) {
      database.exec(`
        CREATE TABLE migration_recipes (
          id INTEGER PRIMARY KEY,
          key TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          version INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('dependency_upgrade')),
          configuration TEXT NOT NULL,
          validation_kinds TEXT NOT NULL,
          default_canary_count INTEGER NOT NULL DEFAULT 1,
          default_wave_size INTEGER NOT NULL DEFAULT 5,
          rollback_guidance TEXT NOT NULL,
          creator TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX migration_recipes_version ON migration_recipes(key, version);

        CREATE TABLE migration_campaigns (
          id INTEGER PRIMARY KEY,
          federation_group_id TEXT NOT NULL UNIQUE,
          recipe_id INTEGER NOT NULL REFERENCES migration_recipes(id),
          state TEXT NOT NULL,
          canary_count INTEGER NOT NULL,
          wave_size INTEGER NOT NULL,
          concurrency INTEGER NOT NULL,
          writes_approved INTEGER NOT NULL DEFAULT 0,
          create_pull_requests INTEGER NOT NULL DEFAULT 0,
          current_wave INTEGER NOT NULL DEFAULT 0,
          creator TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          finished_at TEXT
        );
        CREATE INDEX migration_campaigns_recent ON migration_campaigns(id DESC, updated_at DESC);

        CREATE TABLE migration_targets (
          id INTEGER PRIMARY KEY,
          campaign_id INTEGER NOT NULL REFERENCES migration_campaigns(id) ON DELETE CASCADE,
          repository_id INTEGER NOT NULL REFERENCES repositories(id),
          base_revision TEXT NOT NULL,
          wave INTEGER NOT NULL,
          state TEXT NOT NULL,
          applicability TEXT NOT NULL DEFAULT 'pending',
          applicability_reason TEXT,
          predicted_changes TEXT NOT NULL DEFAULT '[]',
          work_item_id INTEGER REFERENCES work_items(id) ON DELETE SET NULL,
          job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
          pull_request_number INTEGER,
          pull_request_url TEXT,
          impact_analysis_id INTEGER REFERENCES impact_analyses(id) ON DELETE SET NULL,
          error TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(campaign_id, repository_id)
        );
        CREATE INDEX migration_targets_campaign_wave ON migration_targets(campaign_id, wave, state);

        CREATE TABLE migration_attempts (
          id INTEGER PRIMARY KEY,
          campaign_id INTEGER NOT NULL REFERENCES migration_campaigns(id) ON DELETE CASCADE,
          target_id INTEGER NOT NULL REFERENCES migration_targets(id) ON DELETE CASCADE,
          attempt INTEGER NOT NULL,
          kind TEXT NOT NULL,
          input_revision TEXT NOT NULL,
          output_revision TEXT,
          tool_version TEXT NOT NULL,
          status TEXT NOT NULL,
          log TEXT NOT NULL DEFAULT '',
          error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at TEXT,
          UNIQUE(target_id, attempt)
        );
      `)
    },
  },
  {
    version: 38,
    name: 'development-impact-feedback',
    migrate(database) {
      database.exec(`
        CREATE TABLE impact_analysis_feedback (
          id INTEGER PRIMARY KEY,
          analysis_id INTEGER NOT NULL REFERENCES impact_analyses(id) ON DELETE CASCADE,
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('false_positive','missing_relationship')),
          node_key TEXT,
          from_node_key TEXT,
          to_node_key TEXT,
          relation TEXT,
          comment TEXT NOT NULL,
          actor TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX impact_analysis_feedback_analysis ON impact_analysis_feedback(analysis_id, id DESC);
      `)
    },
  },
  {
    version: 39,
    name: 'development-validation-artifacts-and-migration-evidence',
    migrate(database) {
      database.exec(`
        ALTER TABLE repository_test_targets ADD COLUMN artifact_paths TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE validation_runs ADD COLUMN artifacts TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE validation_runs ADD COLUMN parent_run_id INTEGER REFERENCES validation_runs(id) ON DELETE SET NULL;
        ALTER TABLE migration_targets ADD COLUMN output_revision TEXT;
        ALTER TABLE migration_targets ADD COLUMN validation_run_ids TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE migration_targets ADD COLUMN evidence_snapshot_id INTEGER REFERENCES pull_request_evidence_snapshots(id) ON DELETE SET NULL;
        CREATE INDEX validation_runs_parent ON validation_runs(parent_run_id, id);
      `)
    },
  },
  {
    version: 40,
    name: 'development-bounded-repair-loops',
    migrate(database) {
      database.exec(`
        CREATE TABLE validation_repair_loops (
          id INTEGER PRIMARY KEY,
          root_run_id INTEGER NOT NULL UNIQUE REFERENCES validation_runs(id) ON DELETE CASCADE,
          current_run_id INTEGER NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
          current_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
          state TEXT NOT NULL CHECK(state IN ('active','completed','stopped','cancelled')),
          max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 3),
          attempt_count INTEGER NOT NULL,
          deadline_at TEXT NOT NULL,
          stop_reason TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at TEXT
        );
        CREATE INDEX validation_repair_loops_state ON validation_repair_loops(state, id);
      `)
    },
  },
]

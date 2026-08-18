import { DatabaseSync } from 'node:sqlite'
import { ensureWorkSchema } from './work-schema.ts'
import { baseSchema } from './base-schema.ts'
import { migrateCanonicalPaths } from './canonical-paths-migration.ts'
import { developmentMigrations } from './development-migrations.ts'
import { developmentIntelligenceMigration } from './development-intelligence-migration.ts'
import { orderedFollowUpMigration } from './ordered-follow-up-migration.ts'
import { runContextMigration } from './run-context-migration.ts'
import { localDirectoryMigration } from './local-directory-migration.ts'
import { automationAgentResourcesMigration } from './automation-agent-resources-migration.ts'
import { agentResourceOverridesMigration } from './agent-resource-overrides-migration.ts'
import { threadMigrations } from './thread-migrations.ts'
import { addColumn, columns, tableExists } from './migration-utils.ts'
import type { Migration } from './migration.ts'

const migrations: Migration[] = [
  {
    version: 1,
    name: 'base-schema',
    migrate(database) {
      database.exec(baseSchema)
    },
  },
  {
    version: 2,
    name: 'legacy-extension-settings',
    migrate(database) {
      for (const [legacyName, moduleId] of [
        ['airtable', 'airtable'],
        ['azure_devops', 'azure-devops'],
        ['github_app', 'github'],
        ['sentry', 'sentry'],
        ['sonarqube', 'sonarqube'],
      ] as const) {
        database
          .prepare(
            `INSERT OR IGNORE INTO encrypted_settings (name, payload, created_at, updated_at)
          SELECT ?, payload, created_at, updated_at FROM encrypted_settings WHERE name=?`,
          )
          .run(`extension:${moduleId}:config`, legacyName)
      }
    },
  },
  {
    version: 3,
    name: 'legacy-inline-columns',
    migrate(database) {
      const repositoryColumns = columns(database, 'repositories')
      addColumn(database, 'repositories', repositoryColumns, 'codex_bootstrapped_at', 'TEXT')
      database.exec(`INSERT OR IGNORE INTO repository_agent_bootstraps (repository_id, agent_id, bootstrapped_at)
        SELECT id, 'codex', codex_bootstrapped_at FROM repositories WHERE codex_bootstrapped_at IS NOT NULL`)

      const scheduleColumns = columns(database, 'scheduled_tasks')
      addColumn(database, 'scheduled_tasks', scheduleColumns, 'model', 'TEXT')
      addColumn(database, 'scheduled_tasks', scheduleColumns, 'reasoning_effort', 'TEXT')
      addColumn(database, 'scheduled_tasks', scheduleColumns, 'agent_id', "TEXT DEFAULT 'codex'")

      const pullRequestColumns = columns(database, 'pull_requests')
      const pullRequestMigrations: Array<[string, string]> = [
        ['labels', 'TEXT'],
        ['created_at', 'TEXT'],
        ['reviewers', 'TEXT'],
        ['auto_reviewed_head_sha', 'TEXT'],
        ['auto_review_watch', 'INTEGER NOT NULL DEFAULT 0'],
        ['merge_state_status', 'TEXT'],
        ['checks_pending', 'INTEGER NOT NULL DEFAULT 0'],
        ['checks_failed', 'INTEGER NOT NULL DEFAULT 0'],
        ['sonar_comment_url', 'TEXT'],
        ['sonar_comment_created_at', 'TEXT'],
        ['sonar_comment_body', 'TEXT'],
        ['sonar_check_failed', 'INTEGER NOT NULL DEFAULT 0'],
        ['author_avatar_url', 'TEXT'],
        ['manual_not_ready_at', 'TEXT'],
        ['updated_after_not_ready_at', 'TEXT'],
        ['latest_comment_at', 'TEXT'],
        ['not_ready_head_sha', 'TEXT'],
        ['not_ready_comment_at', 'TEXT'],
        ['auto_merge_enabled', 'INTEGER NOT NULL DEFAULT 0'],
        ['review_decision', 'TEXT'],
      ]
      for (const [name, definition] of pullRequestMigrations) addColumn(database, 'pull_requests', pullRequestColumns, name, definition)
      database.exec(`UPDATE pull_requests
        SET not_ready_head_sha = COALESCE(not_ready_head_sha, head_sha),
            not_ready_comment_at = COALESCE(not_ready_comment_at, '__migrate__')
        WHERE manual_not_ready_at IS NOT NULL`)

      const previewColumns = columns(database, 'worktree_previews')
      addColumn(database, 'worktree_previews', previewColumns, 'progress', 'TEXT')

      const jobColumns = columns(database, 'jobs')
      const jobMigrations: Array<[string, string]> = [
        ['agent_id', "TEXT NOT NULL DEFAULT 'codex'"],
        ['thread_id', 'TEXT'],
        ['base_repo_path', 'TEXT'],
        ['base_git_dir', 'TEXT'],
        ['head_sha', 'TEXT'],
        ['latest_activity', 'TEXT'],
        ['activity_at', 'TEXT'],
        ['latest_diff', 'TEXT'],
        ['diff_files', 'TEXT'],
        ['diff_additions', 'INTEGER NOT NULL DEFAULT 0'],
        ['diff_deletions', 'INTEGER NOT NULL DEFAULT 0'],
        ['input_request_id', 'TEXT'],
        ['input_questions', 'TEXT'],
        ['input_requested_at', 'TEXT'],
        ['kind', "TEXT NOT NULL DEFAULT 'task'"],
        ['source_job_id', 'INTEGER REFERENCES jobs(id)'],
        ['result_text', 'TEXT'],
        ['task_title', 'TEXT'],
        ['branch_name', 'TEXT'],
        ['linked_pr_number', 'INTEGER'],
        ['linked_pr_url', 'TEXT'],
        ['archived_at', 'TEXT'],
        ['pr_merged_at', 'TEXT'],
        ['pr_closed_at', 'TEXT'],
        ['pr_title', 'TEXT'],
        ['pr_url', 'TEXT'],
        ['worktree_removed_at', 'TEXT'],
        ['review_batch_id', 'INTEGER REFERENCES review_batches(id)'],
        ['review_role', "TEXT DEFAULT 'single'"],
        ['auto_post_review', 'INTEGER NOT NULL DEFAULT 0'],
        ['automatic_review', 'INTEGER NOT NULL DEFAULT 0'],
        ['github_review_post_status', 'TEXT'],
        ['github_review_posted_at', 'TEXT'],
        ['agent_model', 'TEXT'],
        ['agent_reasoning_effort', 'TEXT'],
        ['review_phase', 'TEXT'],
        ['review_phase_started_at', 'TEXT'],
        ['review_details', 'TEXT'],
        ['review_summary', 'TEXT'],
        ['pid_start_identity', 'TEXT'],
      ]
      for (const [name, definition] of jobMigrations) addColumn(database, 'jobs', jobColumns, name, definition)

      const reviewBatchColumns = columns(database, 'review_batches')
      addColumn(database, 'review_batches', reviewBatchColumns, 'launch_errors', 'TEXT')
    },
  },
  {
    version: 4,
    name: 'extension-workflow-runtime',
    migrate(database) {
      database.exec(`
        CREATE TABLE capability_executions (
          id INTEGER PRIMARY KEY,
          capability_kind TEXT NOT NULL CHECK(capability_kind IN ('action','gate','evidence')),
          capability_id TEXT NOT NULL,
          module_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','timed-out')),
          workflow_instance_id INTEGER,
          idempotency_key TEXT,
          input TEXT NOT NULL DEFAULT 'null',
          output TEXT,
          error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          finished_at TEXT
        );
        CREATE UNIQUE INDEX capability_executions_idempotency
          ON capability_executions(capability_kind, capability_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL;
        CREATE INDEX capability_executions_recent ON capability_executions(created_at DESC, id DESC);
        CREATE TABLE automation_recipes (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          trigger_id TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          steps TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_run_at TEXT,
          last_status TEXT,
          last_error TEXT
        );
        CREATE INDEX automation_recipes_trigger ON automation_recipes(trigger_id, enabled);
      `)
    },
  },
  {
    version: 5,
    name: 'extension-lifecycle-migrations',
    migrate(database) {
      database.exec(`CREATE TABLE extension_migrations (
        module_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(module_id, version)
      )`)
    },
  },
  {
    version: 6,
    name: 'job-follow-up-queue',
    migrate(database) {
      database.exec(`
        CREATE TABLE job_follow_up_queue (
          id INTEGER PRIMARY KEY,
          job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          prompt TEXT NOT NULL,
          model TEXT,
          reasoning_effort TEXT,
          status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
          last_error TEXT,
          queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          finished_at TEXT
        );
        CREATE INDEX job_follow_up_queue_position
          ON job_follow_up_queue(job_id, status, queued_at, id);
      `)
    },
  },
  {
    version: 7,
    name: 'automation-trigger-conditions',
    migrate(database) {
      const recipeColumns = columns(database, 'automation_recipes')
      addColumn(
        database,
        'automation_recipes',
        recipeColumns,
        'condition_mode',
        "TEXT NOT NULL DEFAULT 'all' CHECK(condition_mode IN ('all','any'))",
      )
      addColumn(database, 'automation_recipes', recipeColumns, 'conditions', "TEXT NOT NULL DEFAULT '[]'")
    },
  },
  {
    version: 8,
    name: 'automation-thread-actions',
    migrate(database) {
      const recipeColumns = columns(database, 'automation_recipes')
      addColumn(
        database,
        'automation_recipes',
        recipeColumns,
        'thread_action',
        "TEXT NOT NULL DEFAULT 'none' CHECK(thread_action IN ('none','work','review'))",
      )
      addColumn(database, 'automation_recipes', recipeColumns, 'thread_prompt', "TEXT NOT NULL DEFAULT ''")
    },
  },
  {
    version: 9,
    name: 'unified-automation-flows',
    migrate(database) {
      const recipeColumns = columns(database, 'automation_recipes')
      addColumn(database, 'automation_recipes', recipeColumns, 'prompt_steps', "TEXT NOT NULL DEFAULT '[]'")
      addColumn(database, 'automation_recipes', recipeColumns, 'bound_actions', "TEXT NOT NULL DEFAULT '[]'")
      database.exec(`
        CREATE TABLE automation_flow_runs (
          id INTEGER PRIMARY KEY,
          recipe_id INTEGER NOT NULL REFERENCES automation_recipes(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','timed-out')),
          trigger_event TEXT,
          thread_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
          current_phase INTEGER NOT NULL DEFAULT 0,
          phase_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at TEXT
        );
        CREATE INDEX automation_flow_runs_recipe ON automation_flow_runs(recipe_id, created_at DESC);
        CREATE INDEX automation_flow_runs_thread ON automation_flow_runs(thread_job_id, status);
      `)
      const queueColumns = columns(database, 'job_follow_up_queue')
      addColumn(
        database,
        'job_follow_up_queue',
        queueColumns,
        'automation_run_id',
        'INTEGER REFERENCES automation_flow_runs(id) ON DELETE CASCADE',
      )
      addColumn(database, 'job_follow_up_queue', queueColumns, 'automation_phase', 'INTEGER')
    },
  },
  {
    version: 10,
    name: 'approval-gated-improvement-flows',
    migrate(database) {
      const recipeColumns = columns(database, 'automation_recipes')
      addColumn(
        database,
        'automation_recipes',
        recipeColumns,
        'flow_mode',
        "TEXT NOT NULL DEFAULT 'direct' CHECK(flow_mode IN ('direct','improve'))",
      )
      const runColumns = columns(database, 'automation_flow_runs')
      addColumn(database, 'automation_flow_runs', runColumns, 'improvement_items', "TEXT NOT NULL DEFAULT '[]'")
      addColumn(
        database,
        'automation_flow_runs',
        runColumns,
        'improvement_approval_status',
        "TEXT NOT NULL DEFAULT 'not-required' CHECK(improvement_approval_status IN ('not-required','pending','approved','declined'))",
      )
      addColumn(database, 'automation_flow_runs', runColumns, 'selected_improvement_ids', "TEXT NOT NULL DEFAULT '[]'")
      addColumn(database, 'automation_flow_runs', runColumns, 'approval_requested_at', 'TEXT')
      addColumn(database, 'automation_flow_runs', runColumns, 'approved_at', 'TEXT')
    },
  },
  {
    version: 11,
    name: 'automation-flow-idempotency',
    migrate(database) {
      const runColumns = columns(database, 'automation_flow_runs')
      addColumn(database, 'automation_flow_runs', runColumns, 'idempotency_key', 'TEXT')
      database.exec(`CREATE UNIQUE INDEX automation_flow_runs_idempotency
        ON automation_flow_runs(recipe_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL`)
    },
  },
  {
    version: 12,
    name: 'automation-audit-events',
    migrate(database) {
      database.exec(`
        CREATE TABLE automation_audit_events (
          id INTEGER PRIMARY KEY,
          automation_run_id INTEGER NOT NULL REFERENCES automation_flow_runs(id) ON DELETE CASCADE,
          recipe_id INTEGER NOT NULL REFERENCES automation_recipes(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          capability_id TEXT,
          details TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX automation_audit_events_run
          ON automation_audit_events(automation_run_id, created_at, id);
        CREATE INDEX automation_audit_events_recent
          ON automation_audit_events(created_at DESC, id DESC);
      `)
    },
  },
  {
    version: 13,
    name: 'automation-runtime-control',
    migrate(database) {
      database.exec(`
        CREATE TABLE automation_runtime_control (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          paused INTEGER NOT NULL DEFAULT 0,
          reason TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO automation_runtime_control (id) VALUES (1);
        CREATE TABLE automation_control_events (
          id INTEGER PRIMARY KEY,
          paused INTEGER NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `)
    },
  },
  {
    version: 14,
    name: 'query-transform-capabilities',
    migrate(database) {
      database.exec(`
        ALTER TABLE capability_executions RENAME TO capability_executions_v13;
        CREATE TABLE capability_executions (
          id INTEGER PRIMARY KEY,
          capability_kind TEXT NOT NULL CHECK(capability_kind IN ('action','query','transform','gate','evidence')),
          capability_id TEXT NOT NULL,
          module_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','timed-out')),
          workflow_instance_id INTEGER,
          idempotency_key TEXT,
          input TEXT NOT NULL DEFAULT 'null',
          output TEXT,
          error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          finished_at TEXT
        );
        INSERT INTO capability_executions SELECT * FROM capability_executions_v13;
        DROP TABLE capability_executions_v13;
        CREATE UNIQUE INDEX capability_executions_idempotency
          ON capability_executions(capability_kind, capability_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL;
        CREATE INDEX capability_executions_recent ON capability_executions(created_at DESC, id DESC);
      `)
    },
  },
  {
    version: 15,
    name: 'open-capability-primitives',
    migrate(database) {
      const executionColumns = columns(database, 'capability_executions')
      const optionalColumns = ['contextual_action_id', 'entity_kind', 'entity_key'].filter((column) => executionColumns.has(column))
      const coreColumns = [
        'id',
        'capability_kind',
        'capability_id',
        'module_id',
        'status',
        'workflow_instance_id',
        'idempotency_key',
        'input',
        'output',
        'error',
        'attempts',
        'max_attempts',
        'created_at',
        'updated_at',
        'started_at',
        'finished_at',
      ]
      const retainedColumns = [...coreColumns, ...optionalColumns]
      const optionalDefinitions = optionalColumns.map((column) => `${column} TEXT`).join(',\n')
      database.exec(`
        ALTER TABLE capability_executions RENAME TO capability_executions_v14;
        CREATE TABLE capability_executions (
          id INTEGER PRIMARY KEY,
          capability_kind TEXT NOT NULL,
          capability_id TEXT NOT NULL,
          module_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','timed-out')),
          workflow_instance_id INTEGER,
          idempotency_key TEXT,
          input TEXT NOT NULL DEFAULT 'null',
          output TEXT,
          error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          finished_at TEXT
          ${optionalDefinitions ? `,${optionalDefinitions}` : ''}
        );
        INSERT INTO capability_executions (${retainedColumns.join(',')})
          SELECT ${retainedColumns.join(',')} FROM capability_executions_v14;
        DROP TABLE capability_executions_v14;
        CREATE UNIQUE INDEX capability_executions_idempotency
          ON capability_executions(capability_kind, capability_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL;
        CREATE INDEX capability_executions_recent ON capability_executions(created_at DESC, id DESC);
      `)
    },
  },
  {
    version: 16,
    name: 'reconcile-automation-flow-idempotency',
    migrate(database) {
      const runColumns = columns(database, 'automation_flow_runs')
      addColumn(database, 'automation_flow_runs', runColumns, 'idempotency_key', 'TEXT')
      database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS automation_flow_runs_idempotency
        ON automation_flow_runs(recipe_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL`)
    },
  },
  {
    version: 17,
    name: 'reconcile-automation-audit-events',
    migrate(database) {
      if (tableExists(database, 'automation_audit_events')) return
      database.exec(`
        CREATE TABLE automation_audit_events (
          id INTEGER PRIMARY KEY,
          automation_run_id INTEGER NOT NULL REFERENCES automation_flow_runs(id) ON DELETE CASCADE,
          recipe_id INTEGER NOT NULL REFERENCES automation_recipes(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          capability_id TEXT,
          details TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX automation_audit_events_run
          ON automation_audit_events(automation_run_id, created_at, id);
        CREATE INDEX automation_audit_events_recent
          ON automation_audit_events(created_at DESC, id DESC);
      `)
    },
  },
  {
    version: 18,
    name: 'reconcile-automation-runtime-control',
    migrate(database) {
      if (tableExists(database, 'automation_runtime_control')) return
      database.exec(`
        CREATE TABLE automation_runtime_control (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          paused INTEGER NOT NULL DEFAULT 0,
          reason TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO automation_runtime_control (id) VALUES (1);
        CREATE TABLE automation_control_events (
          id INTEGER PRIMARY KEY,
          paused INTEGER NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `)
    },
  },
  {
    version: 19,
    name: 'reconcile-contextual-action-executions',
    migrate(database) {
      const executionColumns = columns(database, 'capability_executions')
      addColumn(database, 'capability_executions', executionColumns, 'contextual_action_id', 'TEXT')
      addColumn(database, 'capability_executions', executionColumns, 'entity_kind', 'TEXT')
      addColumn(database, 'capability_executions', executionColumns, 'entity_key', 'TEXT')
      database.exec(
        'CREATE INDEX IF NOT EXISTS capability_executions_entity ON capability_executions(entity_kind, entity_key, created_at DESC)',
      )
    },
  },
  {
    version: 20,
    name: 'provider-neutral-planning-and-review-delivery',
    migrate(database) {
      database.exec("UPDATE jobs SET kind='planning' WHERE kind='azure_planning'")
      const jobColumns = columns(database, 'jobs')
      addColumn(database, 'jobs', jobColumns, 'review_delivery_provider', 'TEXT')
      addColumn(database, 'jobs', jobColumns, 'review_delivery_status', 'TEXT')
      addColumn(database, 'jobs', jobColumns, 'review_delivered_at', 'TEXT')
      database.exec(`UPDATE jobs
        SET review_delivery_provider=CASE WHEN github_review_post_status IS NOT NULL THEN 'github' END,
            review_delivery_status=github_review_post_status,
            review_delivered_at=github_review_posted_at
        WHERE github_review_post_status IS NOT NULL
          AND review_delivery_status IS NULL`)
    },
  },
  {
    version: 21,
    name: 'reconcile-inbox-triage-state',
    migrate(database) {
      if (tableExists(database, 'inbox_triage_state')) return
      database.exec(`
        CREATE TABLE inbox_triage_state (
          item_id TEXT PRIMARY KEY,
          state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','saved','snoozed','done')),
          snoozed_until TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX inbox_triage_state_queue ON inbox_triage_state(state, snoozed_until, updated_at DESC);
      `)
    },
  },
  {
    version: 22,
    name: 'work-item-combined-workspaces',
    migrate(database) {
      const jobColumns = columns(database, 'jobs')
      addColumn(database, 'jobs', jobColumns, 'session_cwd', 'TEXT')
      addColumn(
        database,
        'jobs',
        jobColumns,
        'workspace_mode',
        "TEXT NOT NULL DEFAULT 'combined' CHECK(workspace_mode IN ('repository','combined'))",
      )
    },
  },
  {
    version: 23,
    name: 'ephemeral-agent-runs',
    migrate(database) {
      addColumn(database, 'jobs', columns(database, 'jobs'), 'ephemeral', 'INTEGER NOT NULL DEFAULT 0')
    },
  },
  {
    version: 24,
    name: 'repository-environment-profiles',
    migrate(database) {
      database.exec(`
        CREATE TABLE repository_environment_profiles (
          id INTEGER PRIMARY KEY,
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          scope_path TEXT NOT NULL DEFAULT '',
          start_command TEXT,
          stop_command TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(repository_id, scope_path)
        );
        CREATE TABLE repository_environment_profile_paths (
          id INTEGER PRIMARY KEY,
          profile_id INTEGER NOT NULL REFERENCES repository_environment_profiles(id) ON DELETE CASCADE,
          relative_path TEXT NOT NULL,
          entry_kind TEXT NOT NULL CHECK(entry_kind IN ('file','directory')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(profile_id, relative_path)
        );
        INSERT INTO repository_environment_profiles (repository_id, scope_path)
          SELECT DISTINCT repository_id, '' FROM repository_environment_paths;
        INSERT INTO repository_environment_profile_paths (profile_id, relative_path, entry_kind, created_at)
          SELECT profile.id, legacy.relative_path, legacy.entry_kind, legacy.created_at
          FROM repository_environment_paths legacy
          JOIN repository_environment_profiles profile
            ON profile.repository_id=legacy.repository_id AND profile.scope_path='';
      `)
    },
  },
  {
    version: 25,
    name: 'subagent-orchestration-permissions',
    migrate(database) {
      addColumn(database, 'scheduled_tasks', columns(database, 'scheduled_tasks'), 'allow_subagents', 'INTEGER NOT NULL DEFAULT 0')
    },
  },
  {
    version: 26,
    name: 'agent-agnostic-subagent-harness',
    migrate(database) {
      const jobColumns = columns(database, 'jobs')
      addColumn(database, 'jobs', jobColumns, 'work_item_id', 'INTEGER')
      addColumn(database, 'jobs', jobColumns, 'allow_subagents', 'INTEGER NOT NULL DEFAULT 0')
      addColumn(database, 'jobs', jobColumns, 'subagent_token_hash', 'TEXT')
      addColumn(database, 'jobs', jobColumns, 'subagent_token_expires_at', 'TEXT')
      addColumn(database, 'jobs', jobColumns, 'subagent_base_sha', 'TEXT')
      addColumn(database, 'jobs', jobColumns, 'subagent_integrated_at', 'TEXT')
      database.exec("CREATE INDEX IF NOT EXISTS jobs_subagents ON jobs(source_job_id,status) WHERE kind='subagent'")
    },
  },
  {
    version: 27,
    name: 'work-domain-schema-ownership',
    migrate(database) {
      ensureWorkSchema(database)
    },
  },
  {
    version: 28,
    name: 'canonical-work-and-automation-paths',
    migrate: migrateCanonicalPaths,
  },
  {
    version: 29,
    name: 'durable-work-cleanup',
    migrate(database) {
      database.exec(`
        CREATE TABLE work_cleanup_tombstones (
          id INTEGER PRIMARY KEY,
          work_item_id INTEGER NOT NULL,
          work_key TEXT NOT NULL,
          work_title TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          next_retry_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT
        );
        CREATE INDEX work_cleanup_tombstones_due ON work_cleanup_tombstones(state,next_retry_at);
        CREATE TABLE work_cleanup_artifacts (
          id INTEGER PRIMARY KEY,
          tombstone_id INTEGER NOT NULL REFERENCES work_cleanup_tombstones(id) ON DELETE CASCADE,
          identity TEXT NOT NULL,
          job_id INTEGER,
          kind TEXT NOT NULL,
          target TEXT NOT NULL,
          metadata TEXT NOT NULL DEFAULT '{}',
          state TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          next_retry_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          UNIQUE(tombstone_id,identity)
        );
        CREATE INDEX work_cleanup_artifacts_due ON work_cleanup_artifacts(state,next_retry_at);
      `)
    },
  },
  {
    version: 30,
    name: 'durable-extension-state',
    migrate(database) {
      database.exec(`CREATE TABLE extension_states (
        module_id TEXT PRIMARY KEY,
        desired_enabled INTEGER NOT NULL,
        applied_enabled INTEGER NOT NULL,
        phase TEXT NOT NULL DEFAULT 'stable',
        operation_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`)
    },
  },
  {
    version: 31,
    name: 'automation-thread-runtime-options',
    migrate(database) {
      database.exec(`
        ALTER TABLE automation_recipes ADD COLUMN agent_id TEXT;
        ALTER TABLE automation_recipes ADD COLUMN model TEXT;
        ALTER TABLE automation_recipes ADD COLUMN reasoning_effort TEXT;
      `)
    },
  },
  {
    version: 32,
    name: 'automation-thread-service-tier',
    migrate(database) {
      database.exec('ALTER TABLE automation_recipes ADD COLUMN service_tier TEXT')
    },
  },
  ...developmentMigrations,
  {
    version: 41,
    name: 'single-active-work-item-worktree',
    migrate(database) {
      database.exec(`
        CREATE TRIGGER jobs_single_active_work_item_worktree_insert
        BEFORE INSERT ON jobs
        WHEN NEW.work_item_id IS NOT NULL
          AND NEW.status IN ('starting','running')
          AND EXISTS (
            SELECT 1 FROM jobs active
            WHERE active.worktree_path=NEW.worktree_path
              AND active.status IN ('starting','running')
              AND NOT (NEW.kind='subagent' AND active.id=NEW.source_job_id)
          )
        BEGIN
          SELECT RAISE(ABORT, 'Work item repository already has an active thread');
        END;

        CREATE TRIGGER jobs_single_active_work_item_worktree_update
        BEFORE UPDATE OF status,worktree_path ON jobs
        WHEN NEW.work_item_id IS NOT NULL
          AND NEW.status IN ('starting','running')
          AND EXISTS (
            SELECT 1 FROM jobs active
            WHERE active.worktree_path=NEW.worktree_path
              AND active.status IN ('starting','running')
              AND active.id<>OLD.id
              AND NOT (NEW.kind='subagent' AND active.id=NEW.source_job_id)
              AND NOT (active.kind='subagent' AND active.source_job_id=NEW.id)
          )
        BEGIN
          SELECT RAISE(ABORT, 'Work item repository already has an active thread');
        END;
      `)
    },
  },
  developmentIntelligenceMigration,
  orderedFollowUpMigration,
  runContextMigration,
  localDirectoryMigration,
  {
    version: 46,
    name: 'automation-schedule-execution-mode',
    migrate(database) {
      database.exec("ALTER TABLE automation_schedules ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'independent'")
    },
  },
  automationAgentResourcesMigration,
  ...threadMigrations,
  agentResourceOverridesMigration,
]

export const dashboardSchemaVersion = migrations.at(-1)?.version || 0

export function migrateDashboardDatabase(database: DatabaseSync | { $client: DatabaseSync }) {
  const nativeDatabase = database instanceof DatabaseSync ? database : database.$client
  nativeDatabase.exec('PRAGMA journal_mode = WAL')
  nativeDatabase.exec('PRAGMA foreign_keys = ON')
  nativeDatabase.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  const applied = new Set(
    nativeDatabase
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => Number(row.version)),
  )
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    nativeDatabase.exec('BEGIN IMMEDIATE')
    try {
      migration.migrate(nativeDatabase)
      nativeDatabase.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name)
      nativeDatabase.exec('COMMIT')
    } catch (error) {
      nativeDatabase.exec('ROLLBACK')
      throw error
    }
  }
}

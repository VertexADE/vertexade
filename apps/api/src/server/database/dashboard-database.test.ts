import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { migrateDashboardDatabase, openDashboardDatabase, type DrizzleDashboardDatabase } from './dashboard-database.ts'

const databases: Array<{ close(): void }> = []
const nativeDatabase = (database: DatabaseSync | DrizzleDashboardDatabase) =>
  database instanceof DatabaseSync ? database : database.$client

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('dashboard database migrations', () => {
  it('creates the current schema and remains idempotent', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)

    migrateDashboardDatabase(database)

    expect(nativeDatabase(database).prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()).toEqual([
      { version: 1, name: 'base-schema' },
      { version: 2, name: 'legacy-extension-settings' },
      { version: 3, name: 'legacy-inline-columns' },
      { version: 4, name: 'extension-workflow-runtime' },
      { version: 5, name: 'extension-lifecycle-migrations' },
      { version: 6, name: 'job-follow-up-queue' },
      { version: 7, name: 'automation-trigger-conditions' },
      { version: 8, name: 'automation-thread-actions' },
      { version: 9, name: 'unified-automation-flows' },
      { version: 10, name: 'approval-gated-improvement-flows' },
      { version: 11, name: 'automation-flow-idempotency' },
      { version: 12, name: 'automation-audit-events' },
      { version: 13, name: 'automation-runtime-control' },
      { version: 14, name: 'query-transform-capabilities' },
      { version: 15, name: 'open-capability-primitives' },
      { version: 16, name: 'reconcile-automation-flow-idempotency' },
      { version: 17, name: 'reconcile-automation-audit-events' },
      { version: 18, name: 'reconcile-automation-runtime-control' },
      { version: 19, name: 'reconcile-contextual-action-executions' },
      { version: 20, name: 'provider-neutral-planning-and-review-delivery' },
      { version: 21, name: 'reconcile-inbox-triage-state' },
      { version: 22, name: 'work-item-combined-workspaces' },
      { version: 23, name: 'ephemeral-agent-runs' },
      { version: 24, name: 'repository-environment-profiles' },
      { version: 25, name: 'subagent-orchestration-permissions' },
      { version: 26, name: 'agent-agnostic-subagent-harness' },
      { version: 27, name: 'work-domain-schema-ownership' },
      { version: 28, name: 'canonical-work-and-automation-paths' },
      { version: 29, name: 'durable-work-cleanup' },
      { version: 30, name: 'durable-extension-state' },
      { version: 31, name: 'automation-thread-runtime-options' },
      { version: 32, name: 'automation-thread-service-tier' },
      { version: 33, name: 'development-impact-analyses' },
      { version: 34, name: 'development-architecture-context' },
      { version: 35, name: 'development-test-intelligence' },
      { version: 36, name: 'development-pull-request-evidence' },
      { version: 37, name: 'development-migration-campaigns' },
      { version: 38, name: 'development-impact-feedback' },
      { version: 39, name: 'development-validation-artifacts-and-migration-evidence' },
      { version: 40, name: 'development-bounded-repair-loops' },
      { version: 41, name: 'single-active-work-item-worktree' },
      { version: 42, name: 'development-repository-knowledge' },
      { version: 43, name: 'ordered-job-follow-up-queue' },
      { version: 44, name: 'agent-run-context-summary' },
      { version: 45, name: 'local-directory-workspaces' },
      { version: 46, name: 'automation-schedule-execution-mode' },
      { version: 47, name: 'automation-agent-resources' },
    ])
    expect(nativeDatabase(database).prepare("SELECT name FROM presets WHERE name='pr'").get()).toEqual({
      name: 'pr',
    })
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(jobs)')
        .all()
        .map((column) => column.name),
    ).toContain('pid_start_identity')
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(jobs)')
        .all()
        .map((column) => column.name),
    ).toEqual(
      expect.arrayContaining([
        'session_cwd',
        'workspace_mode',
        'ephemeral',
        'allow_subagents',
        'subagent_token_hash',
        'subagent_token_expires_at',
        'subagent_base_sha',
        'subagent_integrated_at',
        'run_context',
        'display_prompt',
      ]),
    )
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(pull_requests)')
        .all()
        .map((column) => column.name),
    ).toContain('review_decision')
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(capability_executions)')
        .all()
        .map((column) => column.name),
    ).toContain('idempotency_key')
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(job_follow_up_queue)')
        .all()
        .map((column) => column.name),
    ).toContain('reasoning_effort')
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(automation_recipes)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['condition_mode', 'conditions', 'thread_action', 'prompt_steps', 'bound_actions', 'flow_mode']))
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(automation_schedules)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['recipe_id', 'repository_ids', 'cron_expression', 'next_run_at']))
    expect(nativeDatabase(database).prepare("SELECT name FROM sqlite_master WHERE name='scheduled_tasks'").get()).toBeUndefined()
    expect(
      nativeDatabase(database).prepare("SELECT name FROM sqlite_master WHERE name='repository_environment_paths'").get(),
    ).toBeUndefined()
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(job_follow_up_queue)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['automation_run_id', 'automation_phase']))
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(automation_flow_runs)')
        .all()
        .map((column) => column.name),
    ).toEqual(
      expect.arrayContaining([
        'thread_job_id',
        'improvement_items',
        'improvement_approval_status',
        'selected_improvement_ids',
        'approval_requested_at',
        'approved_at',
        'idempotency_key',
      ]),
    )
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(inbox_triage_state)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['item_id', 'state', 'snoozed_until']))
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(repository_environment_profiles)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['repository_id', 'scope_path', 'start_command', 'stop_command']))
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(automation_audit_events)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['automation_run_id', 'recipe_id', 'event_type', 'capability_id', 'details']))
    expect(nativeDatabase(database).prepare('SELECT paused, reason FROM automation_runtime_control WHERE id=1').get()).toEqual({
      paused: 0,
      reason: '',
    })
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(automation_control_events)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['paused', 'reason', 'created_at']))
    expect(() =>
      nativeDatabase(database)
        .prepare(
          `INSERT INTO capability_executions
      (capability_kind,capability_id,module_id,status,input)
      VALUES ('query','inventory.lookup','inventory','succeeded','null'),
             ('transform','inventory.normalize','inventory','succeeded','null'),
             ('rank','inventory.rank','inventory','succeeded','null')`,
        )
        .run(),
    ).not.toThrow()
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(capability_executions)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['contextual_action_id', 'entity_kind', 'entity_key']))
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(impact_analyses)')
        .all()
        .map((column) => column.name),
    ).toEqual(
      expect.arrayContaining([
        'repository_id',
        'subject_kind',
        'base_revision',
        'head_revision',
        'analyzer_version',
        'execution_id',
        'result',
        'digest',
      ]),
    )
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(architecture_indexes)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['repository_id', 'revision', 'index_version', 'execution_id', 'result', 'digest']))
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(architecture_context_packets)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['repository_id', 'index_id', 'subject_kind', 'subject_key', 'packet', 'byte_budget', 'truncated']))
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(repository_test_targets)')
        .all()
        .map((column) => column.name),
    ).toEqual(
      expect.arrayContaining([
        'repository_id',
        'target_id',
        'executable',
        'args',
        'working_directory',
        'timeout_ms',
        'artifact_paths',
        'enabled',
      ]),
    )
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(validation_runs)')
        .all()
        .map((column) => column.name),
    ).toEqual(
      expect.arrayContaining([
        'repository_id',
        'impact_analysis_id',
        'target_id',
        'target',
        'output',
        'failures',
        'artifacts',
        'base_comparison',
        'repair_work_item_id',
        'repair_job_id',
        'parent_run_id',
      ]),
    )
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(pull_request_evidence_snapshots)')
        .all()
        .map((column) => column.name),
    ).toEqual(
      expect.arrayContaining(['repository_id', 'pull_request_number', 'head_revision', 'policy_version', 'entries', 'counts', 'digest']),
    )
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(validation_repair_loops)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['root_run_id', 'current_run_id', 'current_job_id', 'max_attempts', 'deadline_at', 'stop_reason']))
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(pull_request_evidence_waivers)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['repository_id', 'pull_request_number', 'head_revision', 'entry_key', 'actor', 'reason']))
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(migration_campaigns)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['federation_group_id', 'recipe_id', 'state', 'canary_count', 'wave_size', 'writes_approved']))
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(migration_targets)')
        .all()
        .map((column) => column.name),
    ).toEqual(
      expect.arrayContaining([
        'campaign_id',
        'repository_id',
        'base_revision',
        'wave',
        'applicability',
        'predicted_changes',
        'output_revision',
        'validation_run_ids',
        'evidence_snapshot_id',
      ]),
    )
  })

  it('allows one active thread plus one delegated child in a Work-item repository worktree', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const native = nativeDatabase(database)
    native.exec(`
      INSERT INTO repositories (id,full_name,clone_url,local_path) VALUES (1,'owner/repo','ssh://repo','/repo');
      INSERT INTO work_items (id,key,title) VALUES (7,'W-0007','Shared worktree');
      INSERT INTO jobs (id,repo_id,pr_number,prompt,worktree_path,session_cwd,log_path,status,kind,work_item_id)
      VALUES (1,1,0,'parent','/work-items/W-0007/owner--repo','/work-items/W-0007','/logs/1','running','pre_pr',7);
      INSERT INTO jobs (id,repo_id,pr_number,prompt,worktree_path,session_cwd,log_path,status,kind,source_job_id,work_item_id)
      VALUES (2,1,0,'child','/work-items/W-0007/owner--repo','/work-items/W-0007','/logs/2','starting','subagent',1,7);
    `)

    expect(() =>
      native.exec(`INSERT INTO jobs (id,repo_id,pr_number,prompt,worktree_path,session_cwd,log_path,status,kind,work_item_id)
        VALUES (3,1,0,'other','/work-items/W-0007/owner--repo','/work-items/W-0007','/logs/3','starting','review',7)`),
    ).toThrow('Work item repository already has an active thread')
    expect(() =>
      native.exec(`INSERT INTO jobs (id,repo_id,pr_number,prompt,worktree_path,session_cwd,log_path,status,kind,source_job_id,work_item_id)
        VALUES (4,1,0,'second child','/work-items/W-0007/owner--repo','/work-items/W-0007','/logs/4','starting','subagent',1,7)`),
    ).toThrow('Work item repository already has an active thread')
  })

  it('copies legacy extension settings without replacing an existing scoped value', () => {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    database.exec(`CREATE TABLE encrypted_settings (
      name TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
    nativeDatabase(database).prepare('INSERT INTO encrypted_settings (name, payload) VALUES (?, ?)').run('azure_devops', 'legacy')
    nativeDatabase(database)
      .prepare('INSERT INTO encrypted_settings (name, payload) VALUES (?, ?)')
      .run('extension:github:config', 'current')
    nativeDatabase(database).prepare('INSERT INTO encrypted_settings (name, payload) VALUES (?, ?)').run('github_app', 'legacy-github')

    migrateDashboardDatabase(database)

    expect(
      nativeDatabase(database).prepare("SELECT payload FROM encrypted_settings WHERE name='extension:azure-devops:config'").get(),
    ).toEqual({
      payload: 'legacy',
    })
    expect(nativeDatabase(database).prepare("SELECT payload FROM encrypted_settings WHERE name='extension:github:config'").get()).toEqual({
      payload: 'current',
    })
  })
})

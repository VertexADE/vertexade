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
        .prepare(`INSERT INTO capability_executions
      (capability_kind,capability_id,module_id,status,input)
      VALUES ('query','inventory.lookup','inventory','succeeded','null'),
             ('transform','inventory.normalize','inventory','succeeded','null'),
             ('rank','inventory.rank','inventory','succeeded','null')`)
        .run(),
    ).not.toThrow()
    expect(
      nativeDatabase(database)
        .prepare('PRAGMA table_info(capability_executions)')
        .all()
        .map((column) => column.name),
    ).toEqual(expect.arrayContaining(['contextual_action_id', 'entity_kind', 'entity_key']))
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

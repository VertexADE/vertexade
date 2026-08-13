export const baseSchema = `
  CREATE TABLE IF NOT EXISTS repositories (
    id INTEGER PRIMARY KEY, full_name TEXT NOT NULL UNIQUE, clone_url TEXT NOT NULL,
    local_path TEXT NOT NULL, source_kind TEXT NOT NULL DEFAULT 'git',
    workspace_strategy TEXT NOT NULL DEFAULT 'worktree', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    synced_at TEXT, codex_bootstrapped_at TEXT
  );
  CREATE TABLE IF NOT EXISTS pull_requests (
    id INTEGER PRIMARY KEY, repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    number INTEGER NOT NULL, title TEXT NOT NULL, author TEXT, url TEXT NOT NULL,
    head_ref TEXT, head_sha TEXT, base_ref TEXT, draft INTEGER NOT NULL DEFAULT 0,
    created_at TEXT, updated_at TEXT, labels TEXT, reviewers TEXT,
    auto_reviewed_head_sha TEXT, auto_review_watch INTEGER NOT NULL DEFAULT 0,
    UNIQUE(repo_id, number)
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY, repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    pr_number INTEGER NOT NULL, prompt TEXT NOT NULL, worktree_path TEXT NOT NULL,
    session_cwd TEXT, workspace_mode TEXT NOT NULL DEFAULT 'combined' CHECK(workspace_mode IN ('repository','combined')),
    log_path TEXT NOT NULL, status TEXT NOT NULL, pid INTEGER, exit_code INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT,
    thread_id TEXT, base_repo_path TEXT, base_git_dir TEXT, head_sha TEXT,
    latest_activity TEXT, activity_at TEXT, latest_diff TEXT,
    diff_files TEXT, diff_additions INTEGER NOT NULL DEFAULT 0,
    diff_deletions INTEGER NOT NULL DEFAULT 0, input_request_id TEXT,
    input_questions TEXT, input_requested_at TEXT, kind TEXT NOT NULL DEFAULT 'task',
    source_job_id INTEGER REFERENCES jobs(id), result_text TEXT,
    task_title TEXT, branch_name TEXT, work_item_id INTEGER, linked_pr_number INTEGER, linked_pr_url TEXT,
    archived_at TEXT, pr_merged_at TEXT, agent_id TEXT NOT NULL DEFAULT 'codex',
    automatic_review INTEGER NOT NULL DEFAULT 0, ephemeral INTEGER NOT NULL DEFAULT 0,
    allow_subagents INTEGER NOT NULL DEFAULT 0, subagent_token_hash TEXT,
    subagent_token_expires_at TEXT, subagent_base_sha TEXT, subagent_integrated_at TEXT,
    agent_model TEXT, agent_reasoning_effort TEXT,
    review_phase TEXT, review_phase_started_at TEXT, review_details TEXT, review_summary TEXT
  );
  CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    prompt TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO presets (name, prompt)
  VALUES ('pr', 'Review this pull request with the eyes of a lead engineer.');
  CREATE TABLE IF NOT EXISTS highlight_rules (
    id INTEGER PRIMARY KEY, text TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS service_colors (
    id INTEGER PRIMARY KEY, service TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL UNIQUE, position INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, repository_ids TEXT NOT NULL,
    branch_type TEXT NOT NULL DEFAULT 'chore', schedule_mode TEXT NOT NULL,
    simple_schedule TEXT, cron_expression TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC',
    agent_id TEXT, model TEXT, reasoning_effort TEXT, allow_subagents INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, next_run_at TEXT,
    last_status TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    schedule_id INTEGER REFERENCES scheduled_tasks(id) ON DELETE SET NULL,
    read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS pr_tasks (
    id INTEGER PRIMARY KEY, repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    pr_number INTEGER NOT NULL, analysis_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    title TEXT NOT NULL, rationale TEXT NOT NULL, recommended_base TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done', 'dismissed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(repo_id, pr_number)
  );
  CREATE TABLE IF NOT EXISTS encrypted_settings (
    name TEXT PRIMARY KEY, payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS repository_agent_bootstraps (
    repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL, bootstrapped_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (repository_id, agent_id)
  );
  CREATE TABLE IF NOT EXISTS repository_environment_paths (
    id INTEGER PRIMARY KEY, repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL, entry_kind TEXT NOT NULL CHECK(entry_kind IN ('file','directory')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(repository_id, relative_path)
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    name TEXT PRIMARY KEY, value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS worktree_previews (
    job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','starting','running','stopping','stopped','failed')),
    manifest TEXT, error TEXT, progress TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT, stopped_at TEXT
  );
  CREATE TABLE IF NOT EXISTS review_batches (
    id INTEGER PRIMARY KEY, repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    pr_number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    aggregator_agent_id TEXT NOT NULL, aggregate_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS review_suggestions (
    id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, path TEXT NOT NULL, line INTEGER NOT NULL, side TEXT NOT NULL DEFAULT 'RIGHT',
    description TEXT NOT NULL, replacement TEXT NOT NULL, selected INTEGER NOT NULL DEFAULT 1,
    posted_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(job_id, position)
  );
  CREATE TABLE IF NOT EXISTS automatic_review_queue (
    id INTEGER PRIMARY KEY, repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    pr_number INTEGER NOT NULL, head_sha TEXT NOT NULL, agent_id TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
    queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(repo_id, pr_number, head_sha)
  );
  CREATE INDEX IF NOT EXISTS automatic_review_queue_position ON automatic_review_queue(queued_at, id);
`

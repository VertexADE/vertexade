import type { DatabaseSync } from 'node:sqlite'

export function migrateCanonicalPaths(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE automation_schedules (
      recipe_id INTEGER PRIMARY KEY REFERENCES automation_recipes(id) ON DELETE CASCADE,
      repository_ids TEXT NOT NULL DEFAULT '[]',
      branch_type TEXT NOT NULL DEFAULT 'chore',
      schedule_mode TEXT NOT NULL CHECK(schedule_mode IN ('simple','cron')),
      simple_schedule TEXT CHECK(simple_schedule IS NULL OR simple_schedule IN ('hourly','daily','weekly')),
      cron_expression TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      next_run_at TEXT,
      agent_id TEXT,
      model TEXT,
      reasoning_effort TEXT,
      allow_subagents INTEGER NOT NULL DEFAULT 0
    );
    CREATE TEMP TABLE schedule_recipe_map (
      schedule_id INTEGER PRIMARY KEY,
      recipe_id INTEGER NOT NULL
    );
  `)

  const schedules = database.prepare('SELECT * FROM scheduled_tasks ORDER BY id').all()
  for (const schedule of schedules) {
    const status =
      schedule.last_status === 'running'
        ? 'running'
        : schedule.last_status === 'failed' || schedule.last_status === 'partial'
          ? 'failed'
          : schedule.last_status === 'started'
            ? 'succeeded'
            : null
    const promptSteps = JSON.stringify([{ name: 'Work', prompt: String(schedule.prompt || '') }])
    const inserted = database
      .prepare(`INSERT INTO automation_recipes
        (name,description,trigger_id,enabled,steps,created_at,updated_at,last_run_at,last_status,last_error,
         condition_mode,conditions,thread_action,thread_prompt,prompt_steps,bound_actions,flow_mode)
        VALUES (?,?,'core.scheduled',?,'[]',?,?,?,?,?,'all','[]','work',? ,?,'[]','direct')`)
      .run(
        schedule.name,
        'Runs on a recurring schedule.',
        schedule.enabled,
        schedule.created_at,
        schedule.updated_at,
        schedule.last_run_at,
        status,
        schedule.last_error,
        schedule.prompt,
        promptSteps,
      )
    const recipeId = Number(inserted.lastInsertRowid)
    database
      .prepare(`INSERT INTO automation_schedules
        (recipe_id,repository_ids,branch_type,schedule_mode,simple_schedule,cron_expression,timezone,next_run_at,
         agent_id,model,reasoning_effort,allow_subagents)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        recipeId,
        schedule.repository_ids,
        schedule.branch_type,
        schedule.schedule_mode,
        schedule.simple_schedule,
        schedule.cron_expression,
        schedule.timezone,
        schedule.next_run_at,
        schedule.agent_id,
        schedule.model,
        schedule.reasoning_effort,
        schedule.allow_subagents,
      )
    database.prepare('INSERT INTO schedule_recipe_map (schedule_id,recipe_id) VALUES (?,?)').run(schedule.id, recipeId)
  }

  database.exec(`
    CREATE TABLE notifications_next (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      automation_recipe_id INTEGER REFERENCES automation_recipes(id) ON DELETE SET NULL,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO notifications_next
      (id,kind,title,message,job_id,automation_recipe_id,read_at,created_at)
      SELECT notification.id,notification.kind,notification.title,notification.message,notification.job_id,
             mapping.recipe_id,notification.read_at,notification.created_at
      FROM notifications notification
      LEFT JOIN schedule_recipe_map mapping ON mapping.schedule_id=notification.schedule_id;
    DROP TABLE notifications;
    ALTER TABLE notifications_next RENAME TO notifications;
    DROP TABLE scheduled_tasks;
    DROP TABLE repository_environment_paths;

    UPDATE automation_recipes
    SET trigger_id=replace(trigger_id,'core.agent-run-','core.agent-thread-'),
        conditions=replace(conditions,'"agent-run"','"agent-thread"'),
        steps=replace(steps,'"agent-run"','"agent-thread"'),
        bound_actions=replace(bound_actions,'"agent-run"','"agent-thread"')
    WHERE trigger_id LIKE 'core.agent-run-%'
       OR conditions LIKE '%"agent-run"%'
       OR steps LIKE '%"agent-run"%'
       OR bound_actions LIKE '%"agent-run"%';

    INSERT OR IGNORE INTO encrypted_settings (name,payload,created_at,updated_at)
      SELECT 'extension:airtable:config',payload,created_at,updated_at FROM encrypted_settings WHERE name='airtable';
    INSERT OR IGNORE INTO encrypted_settings (name,payload,created_at,updated_at)
      SELECT 'extension:azure-devops:config',payload,created_at,updated_at FROM encrypted_settings WHERE name='azure_devops';
    INSERT OR IGNORE INTO encrypted_settings (name,payload,created_at,updated_at)
      SELECT 'extension:github:config',payload,created_at,updated_at FROM encrypted_settings WHERE name='github_app';
    INSERT OR IGNORE INTO encrypted_settings (name,payload,created_at,updated_at)
      SELECT 'extension:sentry:config',payload,created_at,updated_at FROM encrypted_settings WHERE name='sentry';
    INSERT OR IGNORE INTO encrypted_settings (name,payload,created_at,updated_at)
      SELECT 'extension:sonarqube:config',payload,created_at,updated_at FROM encrypted_settings WHERE name='sonarqube';
    DELETE FROM encrypted_settings WHERE name IN ('airtable','azure_devops','github_app','sentry','sonarqube');

    UPDATE jobs
    SET review_details=result_text,
        review_summary=COALESCE(review_summary,''),
        review_phase='complete'
    WHERE kind IN ('review','work_review') AND review_phase IS NULL AND result_text IS NOT NULL;
  `)

  const keyRow = database.prepare("SELECT MAX(CAST(SUBSTR(key,3) AS INTEGER)) AS sequence FROM work_items WHERE key GLOB 'W-[0-9]*'").get()
  let sequence = Number(keyRow?.sequence || 0)
  const unlinked = database.prepare('SELECT * FROM jobs WHERE work_item_id IS NULL ORDER BY id').all()
  for (const job of unlinked) {
    sequence += 1
    const key = `W-${String(sequence).padStart(4, '0')}`
    const kind = job.kind === 'review' ? 'pr_review' : job.kind === 'stack_analysis' ? 'investigation' : 'implementation'
    const state =
      job.status === 'completed' ? 'done' : ['starting', 'running', 'resumable'].includes(String(job.status)) ? 'active' : 'backlog'
    const inserted = database
      .prepare(`INSERT INTO work_items (key,title,kind,state,primary_repository_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP))`)
      .run(
        key,
        job.task_title || `Agent thread #${job.id}`,
        kind,
        state,
        job.repo_id,
        job.created_at,
        job.activity_at || job.finished_at || job.created_at,
      )
    database.prepare('UPDATE jobs SET work_item_id=? WHERE id=?').run(Number(inserted.lastInsertRowid), job.id)
  }

  database.exec(`
    CREATE TRIGGER jobs_require_work_item_insert
    BEFORE INSERT ON jobs
    WHEN NEW.work_item_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Agent threads require a Work item');
    END;
    CREATE TRIGGER jobs_require_work_item_update
    BEFORE UPDATE OF work_item_id ON jobs
    WHEN NEW.work_item_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Agent threads require a Work item');
    END;

    ALTER TABLE automation_recipes DROP COLUMN thread_prompt;
    ALTER TABLE repositories DROP COLUMN codex_bootstrapped_at;
  `)
}

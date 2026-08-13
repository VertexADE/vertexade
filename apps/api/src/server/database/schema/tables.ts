import {
  foreignKey,
  sqliteTable,
  type AnySQLiteColumn,
  primaryKey,
  index,
  uniqueIndex,
  unique,
  check,
  integer,
  text,
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export { extensionStates, workCleanupArtifacts, workCleanupTombstones } from './durability-tables.ts'

export const repositories = sqliteTable(
  'repositories',
  {
    id: integer().primaryKey(),
    fullName: text('full_name').notNull(),
    cloneUrl: text('clone_url').notNull(),
    localPath: text('local_path').notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    syncedAt: text('synced_at'),
  },
  (table) => [unique('repositories_full_name_unique').on(table.fullName)],
)

export const pullRequests = sqliteTable('pull_requests', {
  id: integer().primaryKey(),
  repoId: integer('repo_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  number: integer().notNull(),
  title: text().notNull(),
  author: text(),
  url: text().notNull(),
  headRef: text('head_ref'),
  headSha: text('head_sha'),
  baseRef: text('base_ref'),
  draft: integer().default(0).notNull(),
  updatedAt: text('updated_at'),
  labels: text(),
  createdAt: text('created_at'),
  reviewers: text(),
  mergeStateStatus: text('merge_state_status'),
  checksPending: integer('checks_pending').default(0).notNull(),
  checksFailed: integer('checks_failed').default(0).notNull(),
  sonarCommentUrl: text('sonar_comment_url'),
  sonarCommentCreatedAt: text('sonar_comment_created_at'),
  sonarCommentBody: text('sonar_comment_body'),
  sonarCheckFailed: integer('sonar_check_failed').default(0).notNull(),
  authorAvatarUrl: text('author_avatar_url'),
  manualNotReadyAt: text('manual_not_ready_at'),
  updatedAfterNotReadyAt: text('updated_after_not_ready_at'),
  latestCommentAt: text('latest_comment_at'),
  notReadyHeadSha: text('not_ready_head_sha'),
  notReadyCommentAt: text('not_ready_comment_at'),
  autoMergeEnabled: integer('auto_merge_enabled').default(0).notNull(),
  reviewDecision: text('review_decision'),
  autoReviewedHeadSha: text('auto_reviewed_head_sha'),
  autoReviewWatch: integer('auto_review_watch').default(0).notNull(),
})

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer().primaryKey(),
    repoId: integer('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    prompt: text().notNull(),
    worktreePath: text('worktree_path').notNull(),
    logPath: text('log_path').notNull(),
    status: text().notNull(),
    pid: integer(),
    exitCode: integer('exit_code'),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    finishedAt: text('finished_at'),
    threadId: text('thread_id'),
    baseRepoPath: text('base_repo_path'),
    baseGitDir: text('base_git_dir'),
    headSha: text('head_sha'),
    latestActivity: text('latest_activity'),
    activityAt: text('activity_at'),
    latestDiff: text('latest_diff'),
    diffFiles: text('diff_files'),
    diffAdditions: integer('diff_additions').default(0).notNull(),
    diffDeletions: integer('diff_deletions').default(0).notNull(),
    inputRequestId: text('input_request_id'),
    inputQuestions: text('input_questions'),
    inputRequestedAt: text('input_requested_at'),
    kind: text().default('task').notNull(),
    sourceJobId: integer('source_job_id').references((): AnySQLiteColumn => jobs.id),
    resultText: text('result_text'),
    taskTitle: text('task_title'),
    branchName: text('branch_name'),
    linkedPrNumber: integer('linked_pr_number'),
    linkedPrUrl: text('linked_pr_url'),
    archivedAt: text('archived_at'),
    prMergedAt: text('pr_merged_at'),
    prClosedAt: text('pr_closed_at'),
    prTitle: text('pr_title'),
    prUrl: text('pr_url'),
    worktreeRemovedAt: text('worktree_removed_at'),
    agentId: text('agent_id').default('codex').notNull(),
    reviewBatchId: integer('review_batch_id').references((): AnySQLiteColumn => reviewBatches.id),
    reviewRole: text('review_role').default('single'),
    autoPostReview: integer('auto_post_review').default(0).notNull(),
    githubReviewPostStatus: text('github_review_post_status'),
    githubReviewPostedAt: text('github_review_posted_at'),
    automaticReview: integer('automatic_review').default(0).notNull(),
    agentModel: text('agent_model'),
    agentReasoningEffort: text('agent_reasoning_effort'),
    runContext: text('run_context', { mode: 'json' }).$type<Record<string, unknown>>(),
    displayPrompt: text('display_prompt'),
    reviewPhase: text('review_phase'),
    reviewPhaseStartedAt: text('review_phase_started_at'),
    reviewDetails: text('review_details'),
    reviewSummary: text('review_summary'),
    workItemId: integer('work_item_id').references(() => workItems.id),
    pidStartIdentity: text('pid_start_identity'),
    reviewDeliveryProvider: text('review_delivery_provider'),
    reviewDeliveryStatus: text('review_delivery_status'),
    reviewDeliveredAt: text('review_delivered_at'),
    sessionCwd: text('session_cwd'),
    workspaceMode: text('workspace_mode').default('combined').notNull(),
    ephemeral: integer().default(0).notNull(),
    allowSubagents: integer('allow_subagents').default(0).notNull(),
    subagentTokenHash: text('subagent_token_hash'),
    subagentTokenExpiresAt: text('subagent_token_expires_at'),
    subagentBaseSha: text('subagent_base_sha'),
    subagentIntegratedAt: text('subagent_integrated_at'),
  },
  (table) => [index('jobs_subagents').on(table.sourceJobId, table.status)],
)

export const presets = sqliteTable(
  'presets',
  {
    id: integer().primaryKey(),
    name: text().notNull(),
    prompt: text().notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [unique('presets_name_unique').on(table.name)],
)

export const highlightRules = sqliteTable(
  'highlight_rules',
  {
    id: integer().primaryKey(),
    text: text().notNull(),
    color: text().notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [unique('highlight_rules_text_unique').on(table.text)],
)

export const serviceColors = sqliteTable(
  'service_colors',
  {
    id: integer().primaryKey(),
    service: text().notNull(),
    color: text().notNull(),
    position: integer().notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    unique('service_colors_service_unique').on(table.service),
    unique('service_colors_color_unique').on(table.color),
    unique('service_colors_position_unique').on(table.position),
  ],
)

export const prTasks = sqliteTable('pr_tasks', {
  id: integer().primaryKey(),
  repoId: integer('repo_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  prNumber: integer('pr_number').notNull(),
  analysisJobId: integer('analysis_job_id').references(() => jobs.id, {
    onDelete: 'set null',
  }),
  title: text().notNull(),
  rationale: text().notNull(),
  recommendedBase: text('recommended_base'),
  status: text().default('open').notNull(),
  createdAt: text('created_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: text('updated_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
})

export const notifications = sqliteTable('notifications', {
  id: integer().primaryKey(),
  kind: text().notNull(),
  title: text().notNull(),
  message: text().notNull(),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  automationRecipeId: integer('automation_recipe_id').references(() => automationRecipes.id, { onDelete: 'set null' }),
  readAt: text('read_at'),
  createdAt: text('created_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
})

export const encryptedSettings = sqliteTable('encrypted_settings', {
  name: text().primaryKey(),
  payload: text().notNull(),
  createdAt: text('created_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: text('updated_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
})

export const repositoryAgentBootstraps = sqliteTable(
  'repository_agent_bootstraps',
  {
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    bootstrappedAt: text('bootstrapped_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.repositoryId, table.agentId],
      name: 'repository_agent_bootstraps_pk',
    }),
  ],
)

export const appSettings = sqliteTable('app_settings', {
  name: text().primaryKey(),
  value: text().notNull(),
  updatedAt: text('updated_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
})

export const reviewBatches = sqliteTable('review_batches', {
  id: integer().primaryKey(),
  repoId: integer('repo_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  prNumber: integer('pr_number').notNull(),
  status: text().default('pending').notNull(),
  aggregatorAgentId: text('aggregator_agent_id').notNull(),
  aggregateJobId: integer('aggregate_job_id').references((): AnySQLiteColumn => jobs.id, { onDelete: 'set null' }),
  createdAt: text('created_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  finishedAt: text('finished_at'),
  launchErrors: text('launch_errors'),
})

export const reviewSuggestions = sqliteTable('review_suggestions', {
  id: integer().primaryKey(),
  jobId: integer('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  position: integer().notNull(),
  path: text().notNull(),
  line: integer().notNull(),
  side: text().default('RIGHT').notNull(),
  description: text().notNull(),
  replacement: text().notNull(),
  selected: integer().default(1).notNull(),
  postedAt: text('posted_at'),
  createdAt: text('created_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
})

export const automaticReviewQueue = sqliteTable(
  'automatic_review_queue',
  {
    id: integer().primaryKey(),
    repoId: integer('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha').notNull(),
    agentId: text('agent_id').notNull(),
    attempts: integer().default(0).notNull(),
    lastError: text('last_error'),
    queuedAt: text('queued_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [index('automatic_review_queue_position').on(table.queuedAt, table.id)],
)

export const workItems = sqliteTable(
  'work_items',
  {
    id: integer().primaryKey(),
    key: text(),
    title: text().notNull(),
    description: text().default('').notNull(),
    kind: text().default('implementation').notNull(),
    state: text().default('backlog').notNull(),
    stateOverride: text('state_override'),
    stateOverrideReason: text('state_override_reason'),
    priority: text().default('normal').notNull(),
    owner: text(),
    primaryRepositoryId: integer('primary_repository_id').references(() => repositories.id, { onDelete: 'set null' }),
    attention: text(),
    archivedAt: text('archived_at'),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    sequentialExecution: integer('sequential_execution').default(0).notNull(),
  },
  (table) => [index('work_items_state').on(table.state, table.updatedAt), unique('work_items_key_unique').on(table.key)],
)

export const workResources = sqliteTable(
  'work_resources',
  {
    id: integer().primaryKey(),
    provider: text().notNull(),
    kind: text().notNull(),
    externalId: text('external_id').notNull(),
    repositoryId: integer('repository_id').references(() => repositories.id, {
      onDelete: 'set null',
    }),
    label: text().notNull(),
    url: text(),
    state: text(),
    metadata: text({ mode: 'json' }).default({}).notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [index('work_resources_identity').on(table.provider, table.kind, table.externalId)],
)

export const workItemResources = sqliteTable(
  'work_item_resources',
  {
    workItemId: integer('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    resourceId: integer('resource_id')
      .notNull()
      .references(() => workResources.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    isPrimary: integer('is_primary').default(0).notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('work_item_resources_item').on(table.workItemId),
    primaryKey({
      columns: [table.workItemId, table.resourceId, table.role],
      name: 'work_item_resources_pk',
    }),
  ],
)

export const workItemRelations = sqliteTable(
  'work_item_relations',
  {
    fromWorkItemId: integer('from_work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    toWorkItemId: integer('to_work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    relation: text().notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.fromWorkItemId, table.toWorkItemId, table.relation],
      name: 'work_item_relations_pk',
    }),
  ],
)

export const workEvents = sqliteTable(
  'work_events',
  {
    id: integer().primaryKey(),
    workItemId: integer('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    summary: text().notNull(),
    actor: text().default('system').notNull(),
    payload: text({ mode: 'json' }).default({}).notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [index('work_events_item').on(table.workItemId, table.createdAt, table.id)],
)

export const workContextTransfers = sqliteTable(
  'work_context_transfers',
  {
    id: integer().primaryKey(),
    workItemId: integer('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    sourceWorkItemId: integer('source_work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    destinationWorkItemId: integer('destination_work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    sourceJobId: integer('source_job_id').references(() => jobs.id, {
      onDelete: 'set null',
    }),
    destinationJobId: integer('destination_job_id').references(() => jobs.id, {
      onDelete: 'set null',
    }),
    status: text().default('pending').notNull(),
    instruction: text().notNull(),
    contextSnapshot: text('context_snapshot').notNull(),
    outputSnapshot: text('output_snapshot'),
    error: text(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (table) => [
    index('work_context_transfers_destination').on(table.destinationJobId, table.status),
    index('work_context_transfers_item').on(table.workItemId, table.createdAt),
  ],
)

export const worktreePreviews = sqliteTable('worktree_previews', {
  jobId: integer('job_id')
    .primaryKey()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  status: text().default('idle').notNull(),
  manifest: text(),
  error: text(),
  createdAt: text('created_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: text('updated_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  startedAt: text('started_at'),
  stoppedAt: text('stopped_at'),
  progress: text(),
})

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: integer().primaryKey(),
  name: text().notNull(),
  appliedAt: text('applied_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
})

export const automationRecipes = sqliteTable(
  'automation_recipes',
  {
    id: integer().primaryKey(),
    name: text().notNull(),
    description: text().default('').notNull(),
    triggerId: text('trigger_id'),
    enabled: integer().default(1).notNull(),
    steps: text({ mode: 'json' }).default([]).notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    lastRunAt: text('last_run_at'),
    lastStatus: text('last_status'),
    lastError: text('last_error'),
    conditionMode: text('condition_mode').default('all').notNull(),
    conditions: text({ mode: 'json' }).default([]).notNull(),
    threadAction: text('thread_action').default('none').notNull(),
    promptSteps: text('prompt_steps', { mode: 'json' }).default([]).notNull(),
    boundActions: text('bound_actions', { mode: 'json' }).default([]).notNull(),
    flowMode: text('flow_mode').default('direct').notNull(),
    agentId: text('agent_id'),
    model: text(),
    reasoningEffort: text('reasoning_effort'),
    serviceTier: text('service_tier'),
  },
  (table) => [index('automation_recipes_trigger').on(table.triggerId, table.enabled)],
)

export const automationSchedules = sqliteTable('automation_schedules', {
  recipeId: integer('recipe_id')
    .primaryKey()
    .references(() => automationRecipes.id, { onDelete: 'cascade' }),
  repositoryIds: text('repository_ids', { mode: 'json' }).$type<number[]>().default([]).notNull(),
  branchType: text('branch_type').default('chore').notNull(),
  scheduleMode: text('schedule_mode').notNull(),
  simpleSchedule: text('simple_schedule'),
  cronExpression: text('cron_expression').notNull(),
  timezone: text().default('UTC').notNull(),
  nextRunAt: text('next_run_at'),
  agentId: text('agent_id'),
  model: text(),
  reasoningEffort: text('reasoning_effort'),
  allowSubagents: integer('allow_subagents').default(0).notNull(),
})

export const extensionMigrations = sqliteTable(
  'extension_migrations',
  {
    moduleId: text('module_id').notNull(),
    version: integer().notNull(),
    name: text().notNull(),
    appliedAt: text('applied_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.moduleId, table.version],
      name: 'extension_migrations_pk',
    }),
  ],
)

export const jobFollowUpQueue = sqliteTable(
  'job_follow_up_queue',
  {
    id: integer().primaryKey(),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    prompt: text().notNull(),
    model: text(),
    reasoningEffort: text('reasoning_effort'),
    position: integer().notNull(),
    status: text().default('queued').notNull(),
    lastError: text('last_error'),
    queuedAt: text('queued_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    automationRunId: integer('automation_run_id').references(() => automationFlowRuns.id, { onDelete: 'cascade' }),
    automationPhase: integer('automation_phase'),
  },
  (table) => [index('job_follow_up_queue_position').on(table.jobId, table.status, table.position, table.id)],
)

export const workAgentResourceOverrides = sqliteTable(
  'work_agent_resource_overrides',
  {
    workItemId: integer('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    resourceKind: text('resource_kind').notNull(),
    resourceId: text('resource_id').notNull(),
    enabled: integer().notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('work_agent_resource_overrides_item').on(table.workItemId, table.resourceKind),
    primaryKey({
      columns: [table.workItemId, table.resourceKind, table.resourceId],
      name: 'work_agent_resource_overrides_pk',
    }),
  ],
)

export const automationFlowRuns = sqliteTable(
  'automation_flow_runs',
  {
    id: integer().primaryKey(),
    recipeId: integer('recipe_id')
      .notNull()
      .references(() => automationRecipes.id, { onDelete: 'cascade' }),
    status: text().notNull(),
    triggerEvent: text('trigger_event'),
    threadJobId: integer('thread_job_id').references(() => jobs.id, {
      onDelete: 'set null',
    }),
    currentPhase: integer('current_phase').default(0).notNull(),
    phaseCount: integer('phase_count').default(0).notNull(),
    lastError: text('last_error'),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    finishedAt: text('finished_at'),
    improvementItems: text('improvement_items', { mode: 'json' }).default([]).notNull(),
    improvementApprovalStatus: text('improvement_approval_status').default('not-required').notNull(),
    selectedImprovementIds: text('selected_improvement_ids', { mode: 'json' }).default([]).notNull(),
    approvalRequestedAt: text('approval_requested_at'),
    approvedAt: text('approved_at'),
    idempotencyKey: text('idempotency_key'),
  },
  (table) => [
    uniqueIndex('automation_flow_runs_idempotency').on(table.recipeId, table.idempotencyKey),
    index('automation_flow_runs_thread').on(table.threadJobId, table.status),
    index('automation_flow_runs_recipe').on(table.recipeId, table.createdAt),
  ],
)

export const sourceControlOperations = sqliteTable(
  'source_control_operations',
  {
    id: integer().primaryKey(),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    action: text().notNull(),
    status: text().notNull(),
    target: text(),
    summary: text(),
    error: text(),
    externalId: text('external_id'),
    durationMs: integer('duration_ms'),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    finishedAt: text('finished_at'),
  },
  (table) => [
    uniqueIndex('source_control_operations_external').on(table.externalId),
    index('source_control_operations_job').on(table.jobId, table.createdAt, table.id),
  ],
)

export const inboxTriageState = sqliteTable(
  'inbox_triage_state',
  {
    itemId: text('item_id').primaryKey(),
    state: text().default('open').notNull(),
    snoozedUntil: text('snoozed_until'),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [index('inbox_triage_state_queue').on(table.state, table.snoozedUntil, table.updatedAt)],
)

export const capabilityExecutions = sqliteTable(
  'capability_executions',
  {
    id: integer().primaryKey(),
    capabilityKind: text('capability_kind').notNull(),
    capabilityId: text('capability_id').notNull(),
    moduleId: text('module_id').notNull(),
    status: text().notNull(),
    workflowInstanceId: integer('workflow_instance_id'),
    idempotencyKey: text('idempotency_key'),
    input: text({ mode: 'json' }).default(null).notNull(),
    output: text(),
    error: text(),
    attempts: integer().default(0).notNull(),
    maxAttempts: integer('max_attempts').default(1).notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    contextualActionId: text('contextual_action_id'),
    entityKind: text('entity_kind'),
    entityKey: text('entity_key'),
  },
  (table) => [
    index('capability_executions_entity').on(table.entityKind, table.entityKey, table.createdAt),
    index('capability_executions_recent').on(table.createdAt, table.id),
    uniqueIndex('capability_executions_idempotency').on(table.capabilityKind, table.capabilityId, table.idempotencyKey),
  ],
)

export const automationAuditEvents = sqliteTable(
  'automation_audit_events',
  {
    id: integer().primaryKey(),
    automationRunId: integer('automation_run_id')
      .notNull()
      .references(() => automationFlowRuns.id, { onDelete: 'cascade' }),
    recipeId: integer('recipe_id')
      .notNull()
      .references(() => automationRecipes.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    capabilityId: text('capability_id'),
    details: text({ mode: 'json' }).default({}).notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('automation_audit_events_recent').on(table.createdAt, table.id),
    index('automation_audit_events_run').on(table.automationRunId, table.createdAt, table.id),
  ],
)

export const automationRuntimeControl = sqliteTable(
  'automation_runtime_control',
  {
    id: integer().primaryKey(),
    paused: integer().default(0).notNull(),
    reason: text().default('').notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [check('automation_runtime_control_check_1', sql`id = 1`)],
)

export const automationControlEvents = sqliteTable('automation_control_events', {
  id: integer().primaryKey(),
  paused: integer().notNull(),
  reason: text().default('').notNull(),
  createdAt: text('created_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
})

export const repositoryEnvironmentProfiles = sqliteTable('repository_environment_profiles', {
  id: integer().primaryKey(),
  repositoryId: integer('repository_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  scopePath: text('scope_path').default('').notNull(),
  startCommand: text('start_command'),
  stopCommand: text('stop_command'),
  createdAt: text('created_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: text('updated_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
})

export const repositoryEnvironmentProfilePaths = sqliteTable('repository_environment_profile_paths', {
  id: integer().primaryKey(),
  profileId: integer('profile_id')
    .notNull()
    .references(() => repositoryEnvironmentProfiles.id, {
      onDelete: 'cascade',
    }),
  relativePath: text('relative_path').notNull(),
  entryKind: text('entry_kind').notNull(),
  createdAt: text('created_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
})

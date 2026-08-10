import { index, integer, sqliteTable, text, type AnySQLiteColumn, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { capabilityExecutions, jobs, repositories, workItems } from './tables.ts'

export const impactAnalyses = sqliteTable(
  'impact_analyses',
  {
    id: integer().primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    subjectKind: text('subject_kind').notNull(),
    pullRequestNumber: integer('pull_request_number'),
    workItemId: integer('work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    baseRevision: text('base_revision').notNull(),
    headRevision: text('head_revision').notNull(),
    analyzerVersion: text('analyzer_version').notNull(),
    status: text().notNull(),
    executionId: integer('execution_id').references(() => capabilityExecutions.id, { onDelete: 'set null' }),
    result: text({ mode: 'json' }).notNull(),
    digest: text().notNull(),
    warningCount: integer('warning_count').default(0).notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    finishedAt: text('finished_at'),
  },
  (table) => [
    index('impact_analyses_repository_recent').on(table.repositoryId, table.createdAt, table.id),
    index('impact_analyses_pull_request').on(table.repositoryId, table.pullRequestNumber, table.headRevision),
    uniqueIndex('impact_analyses_revision').on(
      table.repositoryId,
      table.subjectKind,
      table.baseRevision,
      table.headRevision,
      table.analyzerVersion,
    ),
  ],
)

export const impactAnalysisFeedback = sqliteTable(
  'impact_analysis_feedback',
  {
    id: integer().primaryKey(),
    analysisId: integer('analysis_id')
      .notNull()
      .references(() => impactAnalyses.id, { onDelete: 'cascade' }),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    nodeKey: text('node_key'),
    fromNodeKey: text('from_node_key'),
    toNodeKey: text('to_node_key'),
    relation: text(),
    comment: text().notNull(),
    actor: text().notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [index('impact_analysis_feedback_analysis').on(table.analysisId, table.id)],
)

export const architectureIndexes = sqliteTable(
  'architecture_indexes',
  {
    id: integer().primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    revision: text().notNull(),
    indexVersion: text('index_version').notNull(),
    status: text().notNull(),
    executionId: integer('execution_id').references(() => capabilityExecutions.id, { onDelete: 'set null' }),
    result: text({ mode: 'json' }).notNull(),
    digest: text().notNull(),
    warningCount: integer('warning_count').default(0).notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    finishedAt: text('finished_at'),
  },
  (table) => [
    index('architecture_indexes_repository_recent').on(table.repositoryId, table.createdAt, table.id),
    uniqueIndex('architecture_indexes_revision').on(table.repositoryId, table.revision, table.indexVersion),
  ],
)

export const architectureContextPackets = sqliteTable(
  'architecture_context_packets',
  {
    id: integer().primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    indexId: integer('index_id')
      .notNull()
      .references(() => architectureIndexes.id, { onDelete: 'cascade' }),
    subjectKind: text('subject_kind').notNull(),
    subjectKey: text('subject_key').notNull(),
    revision: text().notNull(),
    subject: text({ mode: 'json' }).notNull(),
    packet: text({ mode: 'json' }).notNull(),
    digest: text().notNull(),
    byteBudget: integer('byte_budget').notNull(),
    estimatedBytes: integer('estimated_bytes').notNull(),
    truncated: integer().default(0).notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('architecture_context_packets_subject').on(table.repositoryId, table.subjectKind, table.subjectKey, table.createdAt),
    uniqueIndex('architecture_context_packets_digest').on(
      table.indexId,
      table.subjectKind,
      table.subjectKey,
      table.byteBudget,
      table.digest,
    ),
  ],
)

export const repositoryTestTargets = sqliteTable(
  'repository_test_targets',
  {
    id: integer().primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    targetId: text('target_id').notNull(),
    projectKey: text('project_key').notNull(),
    projectLabel: text('project_label').notNull(),
    kind: text().notNull(),
    label: text().notNull(),
    script: text().notNull(),
    executable: text().notNull(),
    args: text({ mode: 'json' }).notNull(),
    workingDirectory: text('working_directory').default('.').notNull(),
    timeoutMs: integer('timeout_ms').notNull(),
    artifactPaths: text('artifact_paths', { mode: 'json' }).default([]).notNull(),
    enabled: integer().default(1).notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [uniqueIndex('repository_test_targets_identity').on(table.repositoryId, table.targetId)],
)

export const validationRuns = sqliteTable(
  'validation_runs',
  {
    id: integer().primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    impactAnalysisId: integer('impact_analysis_id')
      .notNull()
      .references(() => impactAnalyses.id, { onDelete: 'cascade' }),
    subjectKind: text('subject_kind').notNull(),
    pullRequestNumber: integer('pull_request_number'),
    baseRevision: text('base_revision').notNull(),
    headRevision: text('head_revision').notNull(),
    targetId: text('target_id').notNull(),
    target: text({ mode: 'json' }).notNull(),
    status: text().notNull(),
    executionId: integer('execution_id').references(() => capabilityExecutions.id, { onDelete: 'set null' }),
    exitCode: integer('exit_code'),
    durationMs: integer('duration_ms'),
    output: text().default('').notNull(),
    outputBytes: integer('output_bytes').default(0).notNull(),
    outputTruncated: integer('output_truncated').default(0).notNull(),
    failures: text({ mode: 'json' }).default([]).notNull(),
    artifacts: text({ mode: 'json' }).default([]).notNull(),
    digest: text(),
    baseComparison: text('base_comparison').default('not_run').notNull(),
    repairWorkItemId: integer('repair_work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    repairJobId: integer('repair_job_id').references(() => jobs.id, { onDelete: 'set null' }),
    parentRunId: integer('parent_run_id').references((): AnySQLiteColumn => validationRuns.id, { onDelete: 'set null' }),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (table) => [
    index('validation_runs_repository_recent').on(table.repositoryId, table.createdAt, table.id),
    index('validation_runs_pull_request').on(table.repositoryId, table.pullRequestNumber, table.headRevision),
    index('validation_runs_impact_target').on(table.impactAnalysisId, table.targetId, table.createdAt),
  ],
)

export const validationRepairLoops = sqliteTable(
  'validation_repair_loops',
  {
    id: integer().primaryKey(),
    rootRunId: integer('root_run_id')
      .notNull()
      .references(() => validationRuns.id, { onDelete: 'cascade' }),
    currentRunId: integer('current_run_id')
      .notNull()
      .references(() => validationRuns.id, { onDelete: 'cascade' }),
    currentJobId: integer('current_job_id').references(() => jobs.id, { onDelete: 'set null' }),
    state: text().notNull(),
    maxAttempts: integer('max_attempts').notNull(),
    attemptCount: integer('attempt_count').notNull(),
    deadlineAt: text('deadline_at').notNull(),
    stopReason: text('stop_reason'),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    finishedAt: text('finished_at'),
  },
  (table) => [
    uniqueIndex('validation_repair_loops_root').on(table.rootRunId),
    index('validation_repair_loops_state').on(table.state, table.id),
  ],
)

export const pullRequestEvidencePolicies = sqliteTable('pull_request_evidence_policies', {
  repositoryId: integer('repository_id')
    .primaryKey()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  version: integer().default(1).notNull(),
  rules: text({ mode: 'json' }).notNull(),
  updatedAt: text('updated_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
})

export const pullRequestEvidenceSnapshots = sqliteTable(
  'pull_request_evidence_snapshots',
  {
    id: integer().primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    pullRequestNumber: integer('pull_request_number').notNull(),
    headRevision: text('head_revision').notNull(),
    policyVersion: integer('policy_version').notNull(),
    readiness: text().notNull(),
    entries: text({ mode: 'json' }).notNull(),
    counts: text({ mode: 'json' }).notNull(),
    digest: text().notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('pull_request_evidence_snapshots_pull').on(table.repositoryId, table.pullRequestNumber, table.id),
    uniqueIndex('pull_request_evidence_snapshots_digest').on(
      table.repositoryId,
      table.pullRequestNumber,
      table.headRevision,
      table.policyVersion,
      table.digest,
    ),
  ],
)

export const pullRequestEvidenceWaivers = sqliteTable(
  'pull_request_evidence_waivers',
  {
    id: integer().primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    pullRequestNumber: integer('pull_request_number').notNull(),
    headRevision: text('head_revision').notNull(),
    entryKey: text('entry_key').notNull(),
    actor: text().notNull(),
    reason: text().notNull(),
    expiresAt: text('expires_at'),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    revokedAt: text('revoked_at'),
  },
  (table) => [index('pull_request_evidence_waivers_pull').on(table.repositoryId, table.pullRequestNumber, table.headRevision)],
)

export const migrationRecipes = sqliteTable(
  'migration_recipes',
  {
    id: integer().primaryKey(),
    key: text().notNull(),
    name: text().notNull(),
    description: text().notNull(),
    version: integer().notNull(),
    kind: text().notNull(),
    configuration: text({ mode: 'json' }).notNull(),
    validationKinds: text('validation_kinds', { mode: 'json' }).notNull(),
    defaultCanaryCount: integer('default_canary_count').default(1).notNull(),
    defaultWaveSize: integer('default_wave_size').default(5).notNull(),
    rollbackGuidance: text('rollback_guidance').notNull(),
    creator: text().notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [uniqueIndex('migration_recipes_version').on(table.key, table.version)],
)

export const migrationCampaigns = sqliteTable(
  'migration_campaigns',
  {
    id: integer().primaryKey(),
    federationGroupId: text('federation_group_id').notNull(),
    recipeId: integer('recipe_id')
      .notNull()
      .references(() => migrationRecipes.id),
    state: text().notNull(),
    canaryCount: integer('canary_count').notNull(),
    waveSize: integer('wave_size').notNull(),
    concurrency: integer().notNull(),
    writesApproved: integer('writes_approved').default(0).notNull(),
    createPullRequests: integer('create_pull_requests').default(0).notNull(),
    currentWave: integer('current_wave').default(0).notNull(),
    creator: text().notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (table) => [
    uniqueIndex('migration_campaigns_federation_child').on(table.federationGroupId),
    index('migration_campaigns_recent').on(table.id, table.updatedAt),
  ],
)

export const migrationTargets = sqliteTable(
  'migration_targets',
  {
    id: integer().primaryKey(),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => migrationCampaigns.id, { onDelete: 'cascade' }),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id),
    baseRevision: text('base_revision').notNull(),
    wave: integer().notNull(),
    state: text().notNull(),
    applicability: text().default('pending').notNull(),
    applicabilityReason: text('applicability_reason'),
    predictedChanges: text('predicted_changes', { mode: 'json' }).default([]).notNull(),
    workItemId: integer('work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    pullRequestNumber: integer('pull_request_number'),
    pullRequestUrl: text('pull_request_url'),
    impactAnalysisId: integer('impact_analysis_id').references(() => impactAnalyses.id, { onDelete: 'set null' }),
    outputRevision: text('output_revision'),
    validationRunIds: text('validation_run_ids', { mode: 'json' }).default([]).notNull(),
    evidenceSnapshotId: integer('evidence_snapshot_id').references(() => pullRequestEvidenceSnapshots.id, { onDelete: 'set null' }),
    error: text(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex('migration_targets_campaign_repository').on(table.campaignId, table.repositoryId),
    index('migration_targets_campaign_wave').on(table.campaignId, table.wave, table.state),
  ],
)

export const migrationAttempts = sqliteTable(
  'migration_attempts',
  {
    id: integer().primaryKey(),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => migrationCampaigns.id, { onDelete: 'cascade' }),
    targetId: integer('target_id')
      .notNull()
      .references(() => migrationTargets.id, { onDelete: 'cascade' }),
    attempt: integer().notNull(),
    kind: text().notNull(),
    inputRevision: text('input_revision').notNull(),
    outputRevision: text('output_revision'),
    toolVersion: text('tool_version').notNull(),
    status: text().notNull(),
    log: text().default('').notNull(),
    error: text(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    finishedAt: text('finished_at'),
  },
  (table) => [uniqueIndex('migration_attempts_number').on(table.targetId, table.attempt)],
)

import type {
  highlightRules,
  automaticReviewQueue,
  jobs,
  presets,
  pullRequests,
  repositories,
  reviewBatches,
  reviewSuggestions,
} from './schema/tables.ts'

type Job = typeof jobs.$inferSelect
type PullRequest = typeof pullRequests.$inferSelect
type Repository = typeof repositories.$inferSelect
type HighlightRule = typeof highlightRules.$inferSelect
type Preset = typeof presets.$inferSelect
type ReviewBatch = typeof reviewBatches.$inferSelect
type ReviewSuggestion = typeof reviewSuggestions.$inferSelect
type AutomaticReviewQueueEntry = typeof automaticReviewQueue.$inferSelect

export function repositoryRecord(row: Repository) {
  return {
    id: row.id,
    full_name: row.fullName,
    clone_url: row.cloneUrl,
    local_path: row.localPath,
    created_at: row.createdAt,
    synced_at: row.syncedAt,
  }
}

export function pullRequestRecord(row: PullRequest) {
  return {
    id: row.id,
    repo_id: row.repoId,
    number: row.number,
    title: row.title,
    author: row.author,
    url: row.url,
    head_ref: row.headRef,
    head_sha: row.headSha,
    base_ref: row.baseRef,
    draft: row.draft,
    updated_at: row.updatedAt,
    labels: row.labels,
    created_at: row.createdAt,
    reviewers: row.reviewers,
    merge_state_status: row.mergeStateStatus,
    checks_pending: row.checksPending,
    checks_failed: row.checksFailed,
    sonar_comment_url: row.sonarCommentUrl,
    sonar_comment_created_at: row.sonarCommentCreatedAt,
    sonar_comment_body: row.sonarCommentBody,
    sonar_check_failed: row.sonarCheckFailed,
    author_avatar_url: row.authorAvatarUrl,
    manual_not_ready_at: row.manualNotReadyAt,
    updated_after_not_ready_at: row.updatedAfterNotReadyAt,
    latest_comment_at: row.latestCommentAt,
    not_ready_head_sha: row.notReadyHeadSha,
    not_ready_comment_at: row.notReadyCommentAt,
    auto_merge_enabled: row.autoMergeEnabled,
    review_decision: row.reviewDecision,
    auto_reviewed_head_sha: row.autoReviewedHeadSha,
    auto_review_watch: row.autoReviewWatch,
  }
}

export function jobRecord(row: Job) {
  return {
    id: row.id,
    repo_id: row.repoId,
    pr_number: row.prNumber,
    prompt: row.prompt,
    worktree_path: row.worktreePath,
    log_path: row.logPath,
    status: row.status,
    pid: row.pid,
    exit_code: row.exitCode,
    created_at: row.createdAt,
    finished_at: row.finishedAt,
    thread_id: row.threadId,
    base_repo_path: row.baseRepoPath,
    base_git_dir: row.baseGitDir,
    head_sha: row.headSha,
    latest_activity: row.latestActivity,
    activity_at: row.activityAt,
    latest_diff: row.latestDiff,
    diff_files: row.diffFiles,
    diff_additions: row.diffAdditions,
    diff_deletions: row.diffDeletions,
    input_request_id: row.inputRequestId,
    input_questions: row.inputQuestions,
    input_requested_at: row.inputRequestedAt,
    kind: row.kind,
    source_job_id: row.sourceJobId,
    result_text: row.resultText,
    task_title: row.taskTitle,
    branch_name: row.branchName,
    linked_pr_number: row.linkedPrNumber,
    linked_pr_url: row.linkedPrUrl,
    archived_at: row.archivedAt,
    pr_merged_at: row.prMergedAt,
    pr_closed_at: row.prClosedAt,
    pr_title: row.prTitle,
    pr_url: row.prUrl,
    worktree_removed_at: row.worktreeRemovedAt,
    agent_id: row.agentId,
    review_batch_id: row.reviewBatchId,
    review_role: row.reviewRole,
    auto_post_review: row.autoPostReview,
    github_review_post_status: row.githubReviewPostStatus,
    github_review_posted_at: row.githubReviewPostedAt,
    automatic_review: row.automaticReview,
    agent_model: row.agentModel,
    agent_reasoning_effort: row.agentReasoningEffort,
    review_phase: row.reviewPhase,
    review_phase_started_at: row.reviewPhaseStartedAt,
    review_details: row.reviewDetails,
    review_summary: row.reviewSummary,
    work_item_id: row.workItemId,
    pid_start_identity: row.pidStartIdentity,
    review_delivery_provider: row.reviewDeliveryProvider,
    review_delivery_status: row.reviewDeliveryStatus,
    review_delivered_at: row.reviewDeliveredAt,
    session_cwd: row.sessionCwd,
    workspace_mode: row.workspaceMode,
    ephemeral: row.ephemeral,
    allow_subagents: row.allowSubagents,
    subagent_token_hash: row.subagentTokenHash,
    subagent_token_expires_at: row.subagentTokenExpiresAt,
    subagent_base_sha: row.subagentBaseSha,
    subagent_integrated_at: row.subagentIntegratedAt,
  }
}

export function presetRecord(row: Preset) {
  return { id: row.id, name: row.name, prompt: row.prompt, created_at: row.createdAt, updated_at: row.updatedAt }
}

export function highlightRuleRecord(row: HighlightRule) {
  return { id: row.id, text: row.text, color: row.color, created_at: row.createdAt, updated_at: row.updatedAt }
}

export function reviewBatchRecord(row: ReviewBatch) {
  return {
    id: row.id,
    repo_id: row.repoId,
    pr_number: row.prNumber,
    status: row.status,
    aggregator_agent_id: row.aggregatorAgentId,
    aggregate_job_id: row.aggregateJobId,
    created_at: row.createdAt,
    finished_at: row.finishedAt,
    launch_errors: row.launchErrors,
  }
}

export function reviewSuggestionRecord(row: ReviewSuggestion) {
  return {
    id: row.id,
    job_id: row.jobId,
    position: row.position,
    path: row.path,
    line: row.line,
    side: row.side,
    description: row.description,
    replacement: row.replacement,
    selected: row.selected,
    posted_at: row.postedAt,
    created_at: row.createdAt,
  }
}

export function automaticReviewQueueRecord(row: AutomaticReviewQueueEntry) {
  return {
    id: row.id,
    repo_id: row.repoId,
    pr_number: row.prNumber,
    head_sha: row.headSha,
    agent_id: row.agentId,
    attempts: row.attempts,
    last_error: row.lastError,
    queued_at: row.queuedAt,
    updated_at: row.updatedAt,
  }
}

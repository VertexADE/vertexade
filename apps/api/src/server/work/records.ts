import type { jobs, workContextTransfers, workEvents, workItemRelations, workItems, workResources } from '../database/schema/tables.ts'

type Job = typeof jobs.$inferSelect
type WorkContextTransfer = typeof workContextTransfers.$inferSelect
type WorkEvent = typeof workEvents.$inferSelect
type WorkItem = typeof workItems.$inferSelect
type WorkRelation = typeof workItemRelations.$inferSelect
type WorkResource = typeof workResources.$inferSelect

export function workItemRecord(row: WorkItem) {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    kind: row.kind,
    state: row.state,
    state_override: row.stateOverride,
    state_override_reason: row.stateOverrideReason,
    priority: row.priority,
    owner: row.owner,
    primary_repository_id: row.primaryRepositoryId,
    attention: row.attention,
    archived_at: row.archivedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    sequential_execution: row.sequentialExecution,
  }
}

export function workResourceRecord(row: WorkResource) {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    external_id: row.externalId,
    repository_id: row.repositoryId,
    label: row.label,
    url: row.url,
    state: row.state,
    metadata: row.metadata,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export function workEventRecord(row: WorkEvent) {
  return {
    id: row.id,
    work_item_id: row.workItemId,
    event_type: row.eventType,
    summary: row.summary,
    actor: row.actor,
    payload: row.payload,
    created_at: row.createdAt,
  }
}

export function workRelationRecord(row: WorkRelation) {
  return {
    from_work_item_id: row.fromWorkItemId,
    to_work_item_id: row.toWorkItemId,
    relation: row.relation,
    created_at: row.createdAt,
  }
}

export function workContextTransferRecord(row: WorkContextTransfer) {
  return {
    id: row.id,
    work_item_id: row.workItemId,
    source_work_item_id: row.sourceWorkItemId,
    destination_work_item_id: row.destinationWorkItemId,
    source_job_id: row.sourceJobId,
    destination_job_id: row.destinationJobId,
    status: row.status,
    instruction: row.instruction,
    context_snapshot: row.contextSnapshot,
    output_snapshot: row.outputSnapshot,
    error: row.error,
    created_at: row.createdAt,
    started_at: row.startedAt,
    finished_at: row.finishedAt,
  }
}

export function workJobRecord(
  row: Omit<
    Pick<
      Job,
      | 'id'
      | 'status'
      | 'kind'
      | 'threadId'
      | 'agentId'
      | 'taskTitle'
      | 'prNumber'
      | 'branchName'
      | 'latestActivity'
      | 'activityAt'
      | 'createdAt'
      | 'finishedAt'
      | 'inputQuestions'
      | 'linkedPrNumber'
      | 'headSha'
      | 'diffFiles'
      | 'diffAdditions'
      | 'diffDeletions'
      | 'worktreePath'
      | 'sessionCwd'
      | 'workspaceMode'
      | 'worktreeRemovedAt'
    >,
    'diffFiles'
  > & {
    diffFiles?: Job['diffFiles']
    fullName: string
    workItemId?: number | null
  },
) {
  return {
    id: row.id,
    work_item_id: row.workItemId,
    status: row.status,
    kind: row.kind,
    thread_id: row.threadId,
    agent_id: row.agentId,
    task_title: row.taskTitle,
    pr_number: row.prNumber,
    branch_name: row.branchName,
    latest_activity: row.latestActivity,
    activity_at: row.activityAt,
    created_at: row.createdAt,
    finished_at: row.finishedAt,
    input_questions: row.inputQuestions,
    linked_pr_number: row.linkedPrNumber,
    head_sha: row.headSha,
    ...(row.diffFiles === undefined ? {} : { diff_files: row.diffFiles }),
    diff_additions: row.diffAdditions,
    diff_deletions: row.diffDeletions,
    worktree_path: row.worktreePath,
    session_cwd: row.sessionCwd,
    workspace_mode: row.workspaceMode,
    worktree_removed_at: row.worktreeRemovedAt,
    full_name: row.fullName,
  }
}

import type { ModuleCatalogEntry, PullRequestReadiness, WorkItemWorkspaceMode } from '@vertexade/platform-contracts'
import type { BackendAttributed, BackendDescriptor } from './backend-registry'

export type Repository = BackendAttributed & {
  id: number
  full_name: string
  local_path: string
  synced_at: string | null
}

export type PullRequest = BackendAttributed & {
  id: number
  repo_id: number
  full_name: string
  number: number
  title: string
  author: string
  author_avatar_url: string | null
  url: string
  base_ref: string
  head_ref: string
  head_sha: string
  draft: number
  created_at: string | null
  updated_at: string
  labels: string | null
  reviewers: string | null
  merge_state_status: string | null
  checks_pending: number
  checks_failed: number
  auto_merge_enabled: number
  review_decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  manual_not_ready_at: string | null
  updated_after_not_ready_at: string | null
  auto_review_watch: number
  auto_reviewed_head_sha: string | null
  latest_agent_review_id: number | null
  latest_agent_review_head_sha: string | null
  latest_agent_review_created_at: string | null
  latest_agent_review_finished_at: string | null
  latest_agent_review_agent_id: string | null
  latest_agent_review_automatic: number | null
  work_item_id?: number | null
  work_item_key?: string | null
  evidence_readiness?: PullRequestReadiness | null
  evidence_captured_at?: string | null
}

export type PullRequestDialogItem = Pick<PullRequest, 'repo_id' | 'full_name' | 'number' | 'title' | 'url' | 'head_sha'> &
  Partial<Pick<PullRequest, 'latest_agent_review_head_sha' | 'latest_agent_review_id' | 'auto_review_watch' | 'work_item_key'>>

export type Job = BackendAttributed & {
  id: number
  repo_id: number
  full_name: string
  pr_number: number
  status: string
  thread_id: string | null
  thread_url: string | null
  agent_id: string
  agent_name: string
  agent_accent?: 'neutral' | 'blue' | 'cyan' | 'violet' | 'emerald' | 'amber' | 'orange' | 'rose'
  can_steer: boolean
  ephemeral?: number
  worktree_path: string
  session_cwd?: string | null
  workspace_mode?: WorkItemWorkspaceMode
  head_sha: string | null
  latest_activity: string | null
  activity_at: string | null
  created_at: string
  finished_at: string | null
  diff_files: string | null
  diff_file_count?: number
  diff_additions: number
  diff_deletions: number
  input_questions: string | null
  kind: 'task' | 'review' | 'work_review' | 'review_handoff' | 'pre_pr' | 'stack_analysis' | 'planning' | (string & {})
  kind_label?: string
  kind_title_fallback?: string | null
  kind_tone?: string
  source_job_id: number | null
  subagent_integrated_at?: string | null
  task_title: string | null
  branch_name: string | null
  linked_pr_number: number | null
  linked_pr_url: string | null
  archived_at: string | null
  pr_merged_at: string | null
  pr_closed_at: string | null
  review_phase: 'details' | 'summary' | 'complete' | 'summary_failed' | null
  review_phase_started_at: string | null
  review_details: string | null
  review_summary: string | null
  agent_model: string | null
  agent_reasoning_effort: string | null
  work_item_id: number | null
  queued_follow_up_count?: number
}

export type WorkResource = {
  id: number
  provider: string
  kind: string
  external_id: string
  repository_id: number | null
  label: string
  url: string | null
  state: string | null
  metadata: Record<string, unknown>
  role: string
  is_primary: number
}

export type WorkReferenceSelection = {
  provider: string
  providerName?: string
  kind: string
  externalId: string
  label: string
  url?: string | null
  state?: string | null
  summary?: string | null
  metadata?: Record<string, unknown>
}

export type WorkReferenceCatalog = {
  references: WorkReferenceSelection[]
  providers: Array<{ id: string; name: string; available: boolean; error?: string }>
}

export type WorkEvent = {
  id: number
  event_type: string
  summary: string
  actor: string
  payload: Record<string, unknown>
  created_at: string
}

export type WorkContextTransfer = {
  id: number
  work_item_id: number
  source_work_item_id: number | null
  destination_work_item_id: number | null
  source_job_id: number | null
  destination_job_id: number | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  instruction: string
  context_size: number
  output_captured: number
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type WorkMemory = {
  workItemId: number
  key: string
  path: string
  content: string
  updatedAt: string
}

export type WorkState = 'backlog' | 'active' | 'review' | 'deploy' | 'done'

export type WorkRelation = {
  from_work_item_id: number
  to_work_item_id: number
  relation: 'parent' | 'child' | 'blocks' | 'blocked_by' | 'related' | 'duplicate'
  key: string
  title: string
  state: WorkState
}

export type WorkItem = BackendAttributed & {
  id: number
  key: string
  title: string
  description: string
  kind: 'implementation' | 'pr_review' | 'investigation' | 'operational'
  state: WorkState
  state_override: WorkState | null
  state_override_reason: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  owner: string | null
  primary_repository_id: number | null
  primary_repository_name: string | null
  repository_names: string[]
  attention: string | null
  sequential_execution: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
  resources: WorkResource[]
  threads: (Pick<
    Job,
    | 'id'
    | 'status'
    | 'kind'
    | 'thread_id'
    | 'agent_id'
    | 'task_title'
    | 'pr_number'
    | 'branch_name'
    | 'head_sha'
    | 'latest_activity'
    | 'activity_at'
    | 'created_at'
    | 'finished_at'
    | 'input_questions'
    | 'linked_pr_number'
    | 'full_name'
  > &
    Partial<Pick<Job, 'diff_files' | 'diff_additions' | 'diff_deletions' | 'worktree_path' | 'session_cwd' | 'workspace_mode'>> & {
      worktree_removed_at?: string | null
    })[]
  events: WorkEvent[]
  relations: WorkRelation[]
  context_transfers: WorkContextTransfer[]
}

export type WorkBoardData = {
  items: WorkItem[]
  repositories: Pick<Repository, 'id' | 'full_name' | 'backend_id' | 'backend_name'>[]
}

export type WorkLaunchResult = {
  status: 'started' | 'partial' | 'failed'
  execution_mode: 'direct' | 'sequential'
  workspace_mode: WorkItemWorkspaceMode
  threads: Array<{ id: number; repo_id: number; full_name: string }>
  errors: Array<{ repository: string; error: string }>
}

export type {
  WorkBatchDeletionPreview,
  WorkBatchDeletionResult,
  MergedWorktreeCleanupResult,
  WorkDeletionPreview,
  WorkDeletionResult,
} from '@vertexade/platform-contracts'

export type Preset = { id: number; name: string; prompt: string }
export type HighlightRule = { id: number; text: string; color: string }
export type Notification = {
  id: number
  kind: string
  title: string
  message: string
  job_id: number | null
  automation_recipe_id: number | null
  read_at: string | null
  created_at: string
  work_item_id: number | null
  work_item_key: string | null
}
export type ServiceColor = { service: string; color: string }
export type PrTask = BackendAttributed & {
  id: number
  repo_id: number
  pr_number: number
  analysis_job_id: number | null
  title: string
  rationale: string
  recommended_base: string | null
  status: 'open' | 'done' | 'dismissed'
  full_name: string
  pr_title: string | null
  author: string | null
  url: string | null
  base_ref: string | null
  head_ref: string | null
  merge_state_status: string | null
  checks_pending: number | null
  checks_failed: number | null
}
export type CleanupWorktree = BackendAttributed & {
  job_id: number
  repo_id: number
  full_name: string
  worktree_path: string
  pr_number: number
  pr_title: string | null
  pr_url: string | null
  pr_closed_at: string
  pr_merged_at: string | null
  run_count: number
}
export type DashboardData = {
  repositories: Repository[]
  prs: PullRequest[]
  agentThreads: Job[]
  presets: Preset[]
  highlights: HighlightRule[]
  service_colors: ServiceColor[]
  pr_tasks: PrTask[]
  cleanup_worktrees: CleanupWorktree[]
  modules: ModuleCatalogEntry[]
  backends?: BackendDescriptor[]
  presentation: {
    defaultAgent: { id: string; name: string }
    scm: {
      id: string
      name: string
      changeRequestLabel: string
      changeRequestLabelPlural: string
    }
  }
}

export type GithubLabel = { name: string; color: string; description?: string }
export type GithubReviewer = { login: string; avatar_url?: string }
export type AzureWorkItem = {
  id: number
  rev: number
  title: string
  type: string
  state: string
  iteration_path: string
  area_path: string
  tags: string[]
  assigned_to: { display_name: string; unique_name: string; image_url: string | null } | null
  description: string
  acceptance_criteria: string
  priority: number | null
  story_points: number | null
  effort: number | null
  original_estimate: number | null
  remaining_work: number | null
  completed_work: number | null
  created_at: string | null
  changed_at: string | null
  created_by: string | null
  changed_by: string | null
  url: string | null
  parent_id: string | null
  child_ids: string[]
  board_column?: string
}
export type AzureBoardData = {
  configured: boolean
  project: string | null
  selected_iteration?: string
  story_type?: string
  iterations: {
    id: string
    name: string
    path: string
    start_date: string | null
    finish_date: string | null
    timeframe: string | null
  }[]
  features: AzureWorkItem[]
  items: AzureWorkItem[]
  assignees?: { display_name: string; unique_name: string; image_url: string | null }[]
  areas?: string[]
  states_by_type?: Record<string, string[]>
  taskboard_columns?: { id: string; name: string; order: number }[]
  selected_iteration_id?: string
  selected_team?: string
  repositories?: Pick<Repository, 'id' | 'full_name'>[]
  cache?: import('@vertexade/platform-contracts').ExtensionCacheMetadata
}
export type AzureDraftTask = {
  selected: boolean
  title: string
  description: string
  assigned_to: string
  area_path: string
  tags: string[]
}
export type AzureDraftStory = AzureDraftTask & {
  feature_id: number | null
  acceptance_criteria: string
  subtasks: AzureDraftTask[]
}
export type AzurePlanningResult = { job: Job; drafts?: AzureDraftStory[]; error?: string }
export type LogEvent = {
  kind: string
  title: string
  text: string
  time: string | null
  status?: string
  action_id?: string
  action_kind?: string
  data?: Record<string, unknown>
}
export type DiffFile = {
  path: string
  additions: number
  deletions: number
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  binary: boolean
}
export type JobLog = Job & {
  prompt: string
  display_prompt: string | null
  run_context: RunContext | null
  content: string
  diff: string
  events: LogEvent[]
  input_request_id: string | null
  input_requested_at: string | null
  result_text: string | null
  diff_summary: { files: DiffFile[]; additions: number; deletions: number }
  queued_follow_ups: {
    id: number
    prompt: string
    model: string | null
    reasoning_effort: string | null
    queued_at: string
  }[]
}

export type RunContext = {
  permission?: string
  workspace?: { mode?: string; directory?: string }
  repositories?: Array<{ name?: string; directory?: string; branch?: string; baseBranch?: string }>
  agent?: { id?: string; model?: string | null; reasoningEffort?: string | null; subagents?: boolean }
  delivery?: string
  resources?: { skills?: string[]; mcpServers?: string[] }
  references?: Array<{ provider?: string; kind?: string; label?: string }>
  inputTrust?: string
}

export type JobDiffPreview = {
  diff: string
  diff_summary: { files: DiffFile[]; additions: number; deletions: number }
  truncated: boolean
  omitted_files: string[]
  original_bytes: number
}

export type InputQuestion = {
  id: string
  header: string
  question: string
  isSecret?: boolean
  options?: { label: string; description: string }[] | null
}

export type {
  DeploymentCommit,
  DeploymentOverview,
  DeploymentService,
  DeploymentStage,
  DeploymentTarget,
} from '@vertexade/platform-contracts'

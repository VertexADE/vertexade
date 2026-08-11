export type DevelopmentFreshness = 'current' | 'stale' | 'unknown'

export type DevelopmentExecutionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out'

export type DevelopmentConfidence = 'high' | 'medium' | 'low'

export type DevelopmentArtifactKind = 'impact_analysis' | 'architecture_index'

export type DevelopmentSourceGraphSummary = {
  version: string
  revision: string
  digest: string
  sourceFileCount: number
  edgeCount: number
}

export type DevelopmentKnowledgeKind = 'fact' | 'decision' | 'constraint' | 'risk' | 'pattern' | 'ownership'

export type DevelopmentKnowledgeScope = 'repository' | 'path' | 'boundary'

export type DevelopmentKnowledgeStatus = 'accepted' | 'superseded' | 'archived'

export type DevelopmentArtifactReference = {
  kind: DevelopmentArtifactKind
  id: number
  repositoryId: number
  revision: string
  digest: string
  label: string
}

export type DevelopmentKnowledgeEntry = {
  id: number
  repositoryId: number
  kind: DevelopmentKnowledgeKind
  scope: DevelopmentKnowledgeScope
  title: string
  summary: string
  path: string | null
  boundaryKey: string | null
  confidence: DevelopmentConfidence
  status: DevelopmentKnowledgeStatus
  source: DevelopmentArtifactReference & {
    jobId: number | null
    workItemId: number | null
  }
  supersedesEntryId: number | null
  actor: string
  freshness: DevelopmentFreshness
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type DevelopmentInvestigation = {
  jobId: number
  workItemId: number
  workItemKey: string
  title: string
  status: string
  agentId: string
  model: string | null
  reasoningEffort: string | null
  latestActivity: string | null
  resultSummary: string | null
  revision: string
  digest: string
  createdAt: string
  finishedAt: string | null
}

export type DevelopmentRelatedArtifact = {
  kind: DevelopmentArtifactKind
  id: number
  repositoryId: number
  revision: string
  digest: string
  freshness: DevelopmentFreshness
  summary: string
}

export type DevelopmentIntelligenceOverview = {
  artifact: DevelopmentArtifactReference
  investigations: DevelopmentInvestigation[]
  knowledge: DevelopmentKnowledgeEntry[]
  relatedArtifacts: DevelopmentRelatedArtifact[]
  acceptedKnowledgeDigest: string
}

export type CreateDevelopmentKnowledgeRequest = {
  kind: DevelopmentKnowledgeKind
  scope: DevelopmentKnowledgeScope
  title: string
  summary: string
  path?: string | null
  boundaryKey?: string | null
  confidence: DevelopmentConfidence
  actor?: string
  sourceJobId?: number | null
  supersedesEntryId?: number | null
}

export type LaunchDevelopmentInvestigationRequest = {
  question?: string
}

export type DevelopmentSubject =
  | {
      kind: 'repository_comparison'
      repositoryId: number
      baseRevision: string
      headRevision: string
    }
  | {
      kind: 'pull_request'
      repositoryId: number
      pullRequestNumber: number
      baseRevision: string
      headRevision: string
    }
  | {
      kind: 'work_item'
      repositoryId: number
      workItemId: number
      jobId: number
      baseRevision: string
      headRevision: string
    }
  | {
      kind: 'migration_target'
      repositoryId: number
      campaignId: number
      targetId: number
      baseRevision: string
      headRevision: string
    }

export type DevelopmentExecutionSummary = {
  executionId: number | null
  subject: DevelopmentSubject
  status: DevelopmentExecutionStatus
  freshness: DevelopmentFreshness
  progress: number
  resultVersion: string
  digest: string | null
  warningCount: number
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export type ImpactChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type_changed' | 'unmerged' | 'unknown'

export type ImpactChangedFile = {
  path: string
  previousPath: string | null
  status: ImpactChangedFileStatus
  projectKey: string
}

export type ImpactNodeKind =
  | 'file'
  | 'project'
  | 'package'
  | 'test'
  | 'workflow'
  | 'deployment'
  | 'public_contract'
  | 'database'
  | 'configuration'

export type ImpactNode = {
  key: string
  kind: ImpactNodeKind
  label: string
  path: string | null
  direct: boolean
  confidence: DevelopmentConfidence
}

export type ImpactRelationKind =
  | 'owned_by'
  | 'consumed_by'
  | 'validated_by'
  | 'changes_contract'
  | 'changes_delivery'
  | 'changes_database'
  | 'changes_configuration'

export type ImpactReasonEdge = {
  from: string
  to: string
  relation: ImpactRelationKind
  summary: string
  sourcePath: string | null
  confidence: DevelopmentConfidence
}

export type ImpactValidationKind = 'test' | 'typecheck' | 'lint' | 'build' | 'integration' | 'end_to_end' | 'check'

export type ImpactValidationTarget = {
  id: string
  projectKey: string
  projectLabel: string
  kind: ImpactValidationKind
  script: string
  reason: string
  required: boolean
  confidence: DevelopmentConfidence
}

export type ImpactDeliveryEffect = {
  id: string
  kind: 'workflow' | 'deployment' | 'publication'
  label: string
  path: string | null
  reason: string
  confidence: DevelopmentConfidence
}

export type ImpactWarning = {
  code: string
  message: string
  path: string | null
}

export type ImpactAnalysisResult = {
  analyzerVersion: string
  sourceGraph?: DevelopmentSourceGraphSummary
  repositoryName: string
  changedFiles: ImpactChangedFile[]
  nodes: ImpactNode[]
  edges: ImpactReasonEdge[]
  validationTargets: ImpactValidationTarget[]
  deliveryEffects: ImpactDeliveryEffect[]
  warnings: ImpactWarning[]
  summary: {
    directProjects: number
    transitiveProjects: number
    requiredValidations: number
    deliveryEffects: number
    contractChanges: number
    risk: 'low' | 'medium' | 'high'
  }
}

export type ImpactAnalysis = DevelopmentExecutionSummary & {
  id: number
  result: ImpactAnalysisResult
}

export type ImpactAnalysisListItem = Omit<ImpactAnalysis, 'result'> & {
  repositoryName: string
  changedFileCount: number
  affectedProjectCount: number
  risk: ImpactAnalysisResult['summary']['risk']
}

export type CreateRepositoryImpactAnalysisRequest = {
  baseRevision: string
  headRevision: string
}

export type ImpactAnalysisFeedback = {
  id: number
  analysisId: number
  repositoryId: number
  kind: 'false_positive' | 'missing_relationship'
  nodeKey: string | null
  fromNodeKey: string | null
  toNodeKey: string | null
  relation: string | null
  comment: string
  actor: string
  createdAt: string
}

export type ArchitectureSourceCitation = {
  path: string
  startLine: number | null
  endLine: number | null
  digest: string
}

export type ArchitectureNodeKind =
  | 'repository'
  | 'package'
  | 'service'
  | 'api'
  | 'event'
  | 'datastore'
  | 'deployment'
  | 'extension'
  | 'document'

export type ArchitectureNode = {
  key: string
  kind: ArchitectureNodeKind
  label: string
  summary: string | null
  path: string | null
  citations: ArchitectureSourceCitation[]
}

export type ArchitectureRelationKind =
  | 'contains'
  | 'depends_on'
  | 'exposes'
  | 'publishes'
  | 'consumes'
  | 'persists_to'
  | 'deploys_as'
  | 'documents'

export type ArchitectureRelation = {
  from: string
  to: string
  relation: ArchitectureRelationKind
  summary: string
  confidence: DevelopmentConfidence
  citation: ArchitectureSourceCitation
}

export type ArchitectureDecision = {
  id: string
  title: string
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded' | 'unknown'
  scope: string | null
  supersedes: string | null
  citation: ArchitectureSourceCitation
}

export type ArchitectureIndexResult = {
  indexVersion: string
  sourceGraph?: DevelopmentSourceGraphSummary
  repositoryName: string
  revision: string
  nodes: ArchitectureNode[]
  relations: ArchitectureRelation[]
  decisions: ArchitectureDecision[]
  warnings: ImpactWarning[]
  summary: {
    packages: number
    services: number
    contracts: number
    deployments: number
    decisions: number
  }
}

export type ArchitectureIndex = DevelopmentExecutionSummary & {
  id: number
  result: ArchitectureIndexResult
}

export type ArchitectureContextFact = {
  node: ArchitectureNode
  reason: string
  distance: number
}

export type ArchitectureContextPacket = {
  id: number
  indexId: number
  subject: DevelopmentSubject
  revision: string
  facts: ArchitectureContextFact[]
  relations: ArchitectureRelation[]
  decisions: ArchitectureDecision[]
  citations: ArchitectureSourceCitation[]
  warnings: ImpactWarning[]
  byteBudget: number
  estimatedBytes: number
  truncated: boolean
  digest: string
  freshness: DevelopmentFreshness
  createdAt: string
}

export type TestTargetSource = 'discovered' | 'configured'

export type TestTarget = {
  id: string
  repositoryId: number
  projectKey: string
  projectLabel: string
  kind: ImpactValidationKind
  label: string
  script: string
  executable: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'node'
  args: string[]
  workingDirectory: string
  timeoutMs: number
  artifactPaths: string[]
  source: TestTargetSource
  confidence: DevelopmentConfidence
  enabled: boolean
}

export type TestCatalog = {
  repositoryId: number
  revision: string
  packageManager: TestTarget['executable']
  targets: TestTarget[]
  warnings: ImpactWarning[]
  generatedAt: string
}

export type TestSelectionOmission = {
  targetId: string
  reason: string
}

export type TestSelection = {
  impactAnalysisId: number
  revision: string
  selected: TestTarget[]
  omissions: TestSelectionOmission[]
  coverageGaps: ImpactWarning[]
}

export type NormalizedTestFailure = {
  fingerprint: string
  message: string
  path: string | null
  line: number | null
  column: number | null
  suite: string | null
  test: string | null
}

export type ValidationRunStatus = 'running' | 'passed' | 'failed' | 'cancelled' | 'timed-out'

export type ValidationArtifact = {
  path: string
  status: 'captured' | 'missing'
  kind: 'file' | 'directory' | null
  bytes: number | null
  modifiedAt: string | null
}

export type ValidationRun = {
  id: number
  executionId: number | null
  repositoryId: number
  impactAnalysisId: number
  subject: DevelopmentSubject
  target: TestTarget
  status: ValidationRunStatus
  exitCode: number | null
  durationMs: number | null
  outputBytes: number
  outputTruncated: boolean
  failures: NormalizedTestFailure[]
  artifacts: ValidationArtifact[]
  digest: string | null
  freshness: DevelopmentFreshness
  baseComparison: 'not_run' | 'passed' | 'failed' | 'unknown'
  repairWorkItemId: number | null
  repairJobId: number | null
  parentRunId: number | null
  repairLoop?: ValidationRepairLoop | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type ValidationRepairLoopState = 'active' | 'completed' | 'stopped' | 'cancelled'

export type ValidationRepairLoop = {
  id: number
  rootRunId: number
  currentRunId: number
  currentJobId: number | null
  state: ValidationRepairLoopState
  maxAttempts: number
  attemptCount: number
  deadlineAt: string
  stopReason: 'passed' | 'attempt_limit' | 'elapsed_limit' | 'repeated_fingerprint' | 'broader_impact' | 'repair_failed' | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export type PullRequestTestIntelligence = {
  analysis: ImpactAnalysis | null
  catalog: TestCatalog | null
  selection: TestSelection | null
  runs: ValidationRun[]
}

export type PullRequestEvidenceStatus = 'passed' | 'failed' | 'blocked' | 'not_applicable' | 'unknown' | 'stale'

export type PullRequestEvidenceCategory = 'scope' | 'architecture' | 'validation' | 'review' | 'release' | 'migration'

export type PullRequestEvidenceDecision = 'scope_understood' | 'behavior_validated' | 'review_resolved' | 'release_safe'

export type PullRequestEvidenceWaiver = {
  id: number
  repositoryId: number
  pullRequestNumber: number
  headRevision: string
  entryKey: string
  actor: string
  reason: string
  expiresAt: string | null
  createdAt: string
  revokedAt: string | null
}

export type PullRequestEvidenceEntry = {
  key: string
  category: PullRequestEvidenceCategory
  decision: PullRequestEvidenceDecision
  label: string
  status: PullRequestEvidenceStatus
  required: boolean
  provider: string
  proof: string
  sourceUrl: string | null
  entityReference: string | null
  observedHeadRevision: string | null
  capturedAt: string
  executionId: number | null
  action: 'refresh_impact' | 'build_architecture' | 'run_validation' | 'request_review' | 'collect_provider' | null
  waiver: PullRequestEvidenceWaiver | null
}

export type ReadinessRuleCondition = 'always' | 'contract_change' | 'database_change' | 'delivery_change'

export type PullRequestReadinessRule = {
  entryKey: string
  required: boolean
  condition: ReadinessRuleCondition
}

export type PullRequestReadinessPolicy = {
  repositoryId: number | null
  version: number
  rules: PullRequestReadinessRule[]
  updatedAt: string
}

export type PullRequestReadiness = 'ready' | 'blocked' | 'unknown' | 'stale'

export type PullRequestEvidenceSnapshot = {
  id: number
  repositoryId: number
  pullRequestNumber: number
  headRevision: string
  policyVersion: number
  readiness: PullRequestReadiness
  freshness: DevelopmentFreshness
  entries: PullRequestEvidenceEntry[]
  counts: Record<PullRequestEvidenceStatus, number>
  digest: string
  createdAt: string
}

export type MigrationRecipeKind = 'dependency_upgrade'

export type DependencyUpgradeRecipeConfiguration = {
  kind: 'dependency_upgrade'
  packageName: string
  targetVersion: string
  sections: Array<'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'>
}

export type MigrationRecipeConfiguration = DependencyUpgradeRecipeConfiguration

export type MigrationRecipe = {
  id: number
  key: string
  name: string
  description: string
  version: number
  kind: MigrationRecipeKind
  configuration: MigrationRecipeConfiguration
  validationKinds: ImpactValidationKind[]
  defaultCanaryCount: number
  defaultWaveSize: number
  rollbackGuidance: string
  creator: string
  createdAt: string
}

export type MigrationCampaignState =
  | 'draft'
  | 'preflighting'
  | 'awaiting_approval'
  | 'running'
  | 'paused'
  | 'awaiting_wave_approval'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type MigrationTargetState =
  | 'pending'
  | 'not_applicable'
  | 'preflight_succeeded'
  | 'preflight_failed'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'stale'

export type MigrationPredictedChange = {
  path: string
  summary: string
  before: string
  after: string
}

export type MigrationTarget = {
  id: number
  campaignId: number
  repositoryId: number
  repositoryName: string
  baseRevision: string
  wave: number
  state: MigrationTargetState
  applicability: 'pending' | 'applicable' | 'not_applicable' | 'blocked'
  applicabilityReason: string | null
  predictedChanges: MigrationPredictedChange[]
  workItemId: number | null
  jobId: number | null
  pullRequestNumber: number | null
  pullRequestUrl: string | null
  impactAnalysisId: number | null
  outputRevision: string | null
  validationRunIds: number[]
  evidenceSnapshotId: number | null
  error: string | null
  attemptCount: number
  updatedAt: string
}

export type MigrationCampaign = {
  id: number
  federationGroupId: string
  recipe: MigrationRecipe
  state: MigrationCampaignState
  canaryCount: number
  waveSize: number
  concurrency: number
  writesApproved: boolean
  createPullRequests: boolean
  currentWave: number
  creator: string
  targets: MigrationTarget[]
  counts: Record<MigrationTargetState, number>
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type MigrationAttempt = {
  id: number
  campaignId: number
  targetId: number
  attempt: number
  kind: 'preflight' | 'apply' | 'retry'
  inputRevision: string
  outputRevision: string | null
  toolVersion: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  log: string
  error: string | null
  createdAt: string
  finishedAt: string | null
}

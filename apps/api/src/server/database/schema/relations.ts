import { defineRelations } from 'drizzle-orm'
import * as schema from './tables.ts'

export const relations = defineRelations(schema, (r) => ({
  pullRequests: {
    repository: r.one.repositories({
      from: r.pullRequests.repoId,
      to: r.repositories.id,
    }),
  },
  repositories: {
    pullRequests: r.many.pullRequests(),
    jobsRepoId: r.many.jobs({
      alias: 'jobs_repoId_repositories_id',
    }),
    jobsViaPrTasks: r.many.jobs({
      alias: 'jobs_id_repositories_id_via_prTasks',
    }),
    repositoryAgentBootstraps: r.many.repositoryAgentBootstraps(),
    jobsViaReviewBatches: r.many.jobs({
      alias: 'jobs_id_repositories_id_via_reviewBatches',
    }),
    automaticReviewQueues: r.many.automaticReviewQueue(),
    workItems: r.many.workItems(),
    workResources: r.many.workResources(),
    repositoryEnvironmentProfiles: r.many.repositoryEnvironmentProfiles(),
  },
  jobs: {
    workItem: r.one.workItems({
      from: r.jobs.workItemId,
      to: r.workItems.id,
    }),
    reviewBatch: r.one.reviewBatches({
      from: r.jobs.reviewBatchId,
      to: r.reviewBatches.id,
    }),
    job: r.one.jobs({
      from: r.jobs.sourceJobId,
      to: r.jobs.id,
      alias: 'jobs_sourceJobId_jobs_id',
    }),
    jobs: r.many.jobs({
      alias: 'jobs_sourceJobId_jobs_id',
    }),
    repository: r.one.repositories({
      from: r.jobs.repoId,
      to: r.repositories.id,
      alias: 'jobs_repoId_repositories_id',
    }),
    repositoriesViaPrTasks: r.many.repositories({
      from: r.jobs.id.through(r.prTasks.analysisJobId),
      to: r.repositories.id.through(r.prTasks.repoId),
      alias: 'jobs_id_repositories_id_via_prTasks',
    }),
    repositoriesViaReviewBatches: r.many.repositories({
      from: r.jobs.id.through(r.reviewBatches.aggregateJobId),
      to: r.repositories.id.through(r.reviewBatches.repoId),
      alias: 'jobs_id_repositories_id_via_reviewBatches',
    }),
    reviewSuggestions: r.many.reviewSuggestions(),
    workContextTransfersDestinationJobId: r.many.workContextTransfers({
      alias: 'workContextTransfers_destinationJobId_jobs_id',
    }),
    workContextTransfersSourceJobId: r.many.workContextTransfers({
      alias: 'workContextTransfers_sourceJobId_jobs_id',
    }),
    worktreePreviews: r.many.worktreePreviews(),
    automationFlowRuns: r.many.automationFlowRuns(),
    automationRecipes: r.many.automationRecipes({
      from: r.jobs.id.through(r.automationFlowRuns.threadJobId),
      to: r.automationRecipes.id.through(r.automationFlowRuns.recipeId),
    }),
    sourceControlOperations: r.many.sourceControlOperations(),
  },
  workItems: {
    jobs: r.many.jobs(),
    repository: r.one.repositories({
      from: r.workItems.primaryRepositoryId,
      to: r.repositories.id,
    }),
    workResources: r.many.workResources(),
    workEvents: r.many.workEvents(),
    workContextTransfersDestinationWorkItemId: r.many.workContextTransfers({
      alias: 'workContextTransfers_destinationWorkItemId_workItems_id',
    }),
    workContextTransfersSourceWorkItemId: r.many.workContextTransfers({
      alias: 'workContextTransfers_sourceWorkItemId_workItems_id',
    }),
    workContextTransfersWorkItemId: r.many.workContextTransfers({
      alias: 'workContextTransfers_workItemId_workItems_id',
    }),
    workAgentResourceOverrides: r.many.workAgentResourceOverrides(),
  },
  reviewBatches: {
    jobs: r.many.jobs(),
  },
  automationRecipes: {
    schedule: r.one.automationSchedules({
      from: r.automationRecipes.id,
      to: r.automationSchedules.recipeId,
    }),
    jobs: r.many.jobs(),
    automationFlowRuns: r.many.automationFlowRuns({
      from: r.automationRecipes.id.through(r.automationAuditEvents.recipeId),
      to: r.automationFlowRuns.id.through(r.automationAuditEvents.automationRunId),
    }),
  },
  automationSchedules: {
    recipe: r.one.automationRecipes({
      from: r.automationSchedules.recipeId,
      to: r.automationRecipes.id,
    }),
  },
  repositoryAgentBootstraps: {
    repository: r.one.repositories({
      from: r.repositoryAgentBootstraps.repositoryId,
      to: r.repositories.id,
    }),
  },
  reviewSuggestions: {
    job: r.one.jobs({
      from: r.reviewSuggestions.jobId,
      to: r.jobs.id,
    }),
  },
  automaticReviewQueue: {
    repository: r.one.repositories({
      from: r.automaticReviewQueue.repoId,
      to: r.repositories.id,
    }),
  },
  workResources: {
    repository: r.one.repositories({
      from: r.workResources.repositoryId,
      to: r.repositories.id,
    }),
    workItems: r.many.workItems({
      from: r.workResources.id.through(r.workItemResources.resourceId),
      to: r.workItems.id.through(r.workItemResources.workItemId),
    }),
  },
  workEvents: {
    workItem: r.one.workItems({
      from: r.workEvents.workItemId,
      to: r.workItems.id,
    }),
  },
  workContextTransfers: {
    jobDestinationJobId: r.one.jobs({
      from: r.workContextTransfers.destinationJobId,
      to: r.jobs.id,
      alias: 'workContextTransfers_destinationJobId_jobs_id',
    }),
    jobSourceJobId: r.one.jobs({
      from: r.workContextTransfers.sourceJobId,
      to: r.jobs.id,
      alias: 'workContextTransfers_sourceJobId_jobs_id',
    }),
    workItemDestinationWorkItemId: r.one.workItems({
      from: r.workContextTransfers.destinationWorkItemId,
      to: r.workItems.id,
      alias: 'workContextTransfers_destinationWorkItemId_workItems_id',
    }),
    workItemSourceWorkItemId: r.one.workItems({
      from: r.workContextTransfers.sourceWorkItemId,
      to: r.workItems.id,
      alias: 'workContextTransfers_sourceWorkItemId_workItems_id',
    }),
    workItemWorkItemId: r.one.workItems({
      from: r.workContextTransfers.workItemId,
      to: r.workItems.id,
      alias: 'workContextTransfers_workItemId_workItems_id',
    }),
  },
  worktreePreviews: {
    job: r.one.jobs({
      from: r.worktreePreviews.jobId,
      to: r.jobs.id,
    }),
  },
  automationFlowRuns: {
    jobs: r.many.jobs({
      from: r.automationFlowRuns.id.through(r.jobFollowUpQueue.automationRunId),
      to: r.jobs.id.through(r.jobFollowUpQueue.jobId),
    }),
    automationRecipes: r.many.automationRecipes(),
  },
  workAgentResourceOverrides: {
    workItem: r.one.workItems({
      from: r.workAgentResourceOverrides.workItemId,
      to: r.workItems.id,
    }),
  },
  sourceControlOperations: {
    job: r.one.jobs({
      from: r.sourceControlOperations.jobId,
      to: r.jobs.id,
    }),
  },
  repositoryEnvironmentProfiles: {
    repository: r.one.repositories({
      from: r.repositoryEnvironmentProfiles.repositoryId,
      to: r.repositories.id,
    }),
    repositoryEnvironmentProfilePaths: r.many.repositoryEnvironmentProfilePaths(),
  },
  repositoryEnvironmentProfilePaths: {
    repositoryEnvironmentProfile: r.one.repositoryEnvironmentProfiles({
      from: r.repositoryEnvironmentProfilePaths.profileId,
      to: r.repositoryEnvironmentProfiles.id,
    }),
  },
}))

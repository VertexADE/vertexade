import { and, eq } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { repositoryRecord } from '../database/contract-records.ts'
import { pullRequests, repositories } from '../database/schema/tables.ts'
import type { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import type { CommandResult, RunOptions } from '../process.ts'
import { createCapabilityRoutes } from '../workflows/capability-routes.ts'
import { CapabilityExecutionService } from '../workflows/capability-execution.ts'
import { ArchitectureContextService } from './architecture-service.ts'
import {
  registerCoreArchitectureCapabilities,
  registerCoreDevelopmentCapabilities,
  registerCoreValidationCapabilities,
} from './capabilities.ts'
import { PullRequestEvidenceService } from './evidence-service.ts'
import type { ImpactCommandRunner } from './impact-analyzer.ts'
import { ImpactAnalysisService } from './impact-service.ts'
import { createMigrationRoutes } from './migration-routes.ts'
import { MigrationCampaignService } from './migration-service.ts'
import { ValidationRepairLoopService, type RepairLoopLauncher } from './repair-loop-service.ts'
import { createDevelopmentRoutes } from './routes.ts'
import { ValidationIntelligenceService } from './validation-service.ts'

export type DevelopmentTaskLauncher = (
  repository: ReturnType<typeof repositoryRecord>,
  title: string,
  prompt: string,
  createPullRequest: boolean,
  branchType: 'chore' | 'fix',
  workspace: { revision: string },
  options: { workItemId?: number; workKind: 'implementation'; workSource?: string },
) => Promise<{ id: number; work_item_id?: number | null; linked_pr_number?: number | null; linked_pr_url?: string | null }>

export function createDevelopmentRuntime(input: {
  database: DrizzleDashboardDatabase
  run: ImpactCommandRunner
  runResult(command: string, args: string[], options?: RunOptions): Promise<CommandResult>
  contributions: PlatformCapabilityRegistries
  launchTask: DevelopmentTaskLauncher
  notify(reason: string, id?: number | null): void
  notifyExecutionFailure(title: string, message: string): void
  runtimeDefaults(): { capabilityTimeoutMs: number; retryAttempts: number; retryDelayMs: number }
}) {
  const { database, run, runResult, contributions, launchTask, notify, notifyExecutionFailure, runtimeDefaults } = input
  const impact = new ImpactAnalysisService(database, run, notify)
  const architecture = new ArchitectureContextService(database, run, notify)
  const validation = new ValidationIntelligenceService(database, impact, runResult, notify)
  const evidence = new PullRequestEvidenceService(database, impact, architecture, validation, notify)
  const migration = new MigrationCampaignService(
    database,
    run,
    async ({ repository, title, prompt, baseRevision, createPullRequest, linkedWorkItemId }) => {
      const storedRepository = database.select().from(repositories).where(eq(repositories.id, repository.id)).get()
      if (!storedRepository) throw new Error('Repository not found')
      return launchTask(
        repositoryRecord(storedRepository),
        title,
        prompt,
        createPullRequest,
        'chore',
        { revision: baseRevision },
        {
          workItemId: linkedWorkItemId || undefined,
          workKind: 'implementation',
          workSource: 'migration_campaign',
        },
      )
    },
    async ({ campaign, target, job }) => {
      if (!job.workItemId) throw new Error('Completed migration Work has no linked Work item')
      const pullRequest = job.linkedPrNumber
        ? database
            .select({ number: pullRequests.number })
            .from(pullRequests)
            .where(and(eq(pullRequests.repoId, target.repositoryId), eq(pullRequests.number, job.linkedPrNumber)))
            .get()
        : null
      const prepared = pullRequest
        ? await impact.preparePullRequest(target.repositoryId, pullRequest.number)
        : await impact.prepareWorkItem(job.workItemId)
      const analysis = await impact.analyze(prepared)
      const intelligence = await validation.intelligenceForImpact(analysis.id)
      if (!intelligence.selection) throw new Error('Migration impact did not produce a validation selection')
      if (intelligence.selection.coverageGaps.length) {
        throw new Error(`Migration validation is blocked by ${intelligence.selection.coverageGaps.length} coverage gap(s)`)
      }
      const selected = intelligence.selection.selected.filter((target) => campaign.recipe.validationKinds.includes(target.kind))
      if (!selected.length) throw new Error('No trusted validation targets match the migration recipe policy')
      const validationRunIds: number[] = []
      for (const selectedTarget of selected) {
        const validationRun = await validation.runTarget(
          { repositoryId: target.repositoryId, impactAnalysisId: analysis.id, targetId: selectedTarget.id },
          undefined,
          job.worktreePath,
        )
        validationRunIds.push(validationRun.id)
        if (validationRun.status !== 'passed') {
          throw new Error(`Migration validation failed: ${selectedTarget.label} (${validationRun.status})`)
        }
      }
      const snapshot = pullRequest ? await evidence.collect(target.repositoryId, pullRequest.number) : null
      return {
        outputRevision: analysis.subject.headRevision,
        impactAnalysisId: analysis.id,
        validationRunIds,
        evidenceSnapshotId: snapshot?.id || null,
        log: `Verified ${analysis.subject.headRevision} with ${validationRunIds.length} validation run(s)${snapshot ? ` and evidence snapshot ${snapshot.id}` : ''}`,
      }
    },
    notify,
  )
  registerCoreDevelopmentCapabilities(contributions, impact)
  registerCoreArchitectureCapabilities(contributions, architecture)
  registerCoreValidationCapabilities(contributions, validation)
  let executions: CapabilityExecutionService
  executions = new CapabilityExecutionService(
    database,
    contributions,
    (reason, id) => {
      notify(reason, id)
      if (!id || !['capability_execution_failed', 'capability_execution_timed_out'].includes(reason)) return
      const execution = executions.get(id)
      if (execution) {
        notifyExecutionFailure(`${execution.capabilityId} ${execution.status}`, execution.error || 'Extension capability execution failed')
      }
    },
    runtimeDefaults,
  )
  const launchRepair: RepairLoopLauncher = async ({ run: validationRun, title, prompt, linkedWorkItemId }) => {
    const repository = database.select().from(repositories).where(eq(repositories.id, validationRun.repositoryId)).get()
    if (!repository) throw new Error('Repository not found')
    return launchTask(
      repositoryRecord(repository),
      title,
      prompt,
      false,
      'fix',
      { revision: validationRun.subject.headRevision },
      {
        workItemId: linkedWorkItemId || undefined,
        workKind: 'implementation',
      },
    )
  }
  const repairLoops = new ValidationRepairLoopService(database, impact, validation, executions, launchRepair, notify)
  repairLoops.startScheduler()
  return {
    executions,
    capabilityRoutes: createCapabilityRoutes(executions),
    developmentRoutes: createDevelopmentRoutes(impact, architecture, validation, evidence, executions, launchRepair, repairLoops),
    migrationRoutes: createMigrationRoutes(migration),
  }
}

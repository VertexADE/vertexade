import { appendFile, readFile, mkdir, mkdtemp, realpath, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, basename, delimiter, dirname, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { fileURLToPath } from 'node:url'
import { CronExpressionParser } from 'cron-parser'
import { ensureEncryptionKey } from '../../encrypted-settings.ts'
import { loadModulePlatform } from '../platform/load-platform.ts'
import { HttpError, readRequestBody } from '@vertexade/platform-server/http'
import {
  isCodeReviewKind,
  isReviewSnapshotCurrent,
  reviewRerunSelection,
  reviewSummaryPrompt,
  shouldStartReviewSummary,
} from '../reviews.ts'
import {
  automaticReviewCapacity,
  automaticReviewLaunchAllowed,
  automaticReviewTrigger,
  normalizeAutomaticReviewConcurrency,
} from '../automatic-review-queue.ts'
import { isCompleteDetailedReview, resolveDetailedReviewOutput } from '../review-output.ts'
import {
  aggregateReviewPrompt,
  hardReviewChecks,
  qualityScorecardReviewContract,
  repositoryTopologyReviewContract,
  reviewIntentContract,
} from '../review-prompt-contract.ts'
import { agentProcessEnvironment, migrateAgentEnvironmentsV1, trustWorkspaceMiseConfigs } from '@vertexade/platform-server/agents'
import { selectContextualProvider } from '../platform/provider-selection.ts'
import {
  resolveScmPresentation,
  type Agent,
  type PlanningRefinementRequest,
  type PlanningWorkflowRequest,
} from '@vertexade/platform-contracts'
import type { AgentRegistry } from '../agents/registry.ts'
import type { DashboardExtensionHostServices } from '../extensions/host-services.ts'
import { ExtensionCacheStore } from '../extensions/cache.ts'
import { WorkService } from '../work/service.ts'
import { handleWorkApi } from '../work/http.ts'
import { createWorkCleanup } from '../work/cleanup.ts'
import { withWorktreeOwnershipRepair } from '../work/worktree-ownership.ts'
import { localizePromptImages } from '../prompt-images.ts'
import { readFileTail, readLogEventContext } from '../log-files.ts'
import { processStartIdentity, processWorkingDirectory, runCommand } from '../process.ts'
import { agentSafetyBoundary, untrustedExternalTask } from '../prompts/security.ts'
import { contextTransferPrompt, contextTransferSnapshot } from '../work/context-transfer.ts'
import { WorkMemoryService } from '../work/memory.ts'
import { reusedCombinedWorktree } from '../work/combined-worktree.ts'
import { jobSessionCwd, relativeWorktreePath, workItemLaunchWorkspaceMode, workItemWorkspaceLayout } from '../work/workspace-layout.ts'
import { createCoreRoutes } from '../core-routes.ts'
import { inspectRepositoryEnvironmentEntries, snapshotRepositoryEnvironment } from '../repository-environment.ts'
import { worktreeCodeReviewPrompt } from '../work/prompts.ts'
import { populateWorktreeSnapshot } from '../work/worktree-snapshot.ts'
import { WorktreePreviewRuntime, normalizePreviewSettings } from '../previews/runtime.ts'
import { WorktreePreviewGateway } from '../previews/gateway.ts'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { DashboardEvents } from '../events/dashboard-events.ts'
import { EncryptedSettingsStore, JsonSettingsStore } from '../settings/settings-store.ts'
import { SystemConfiguration } from '../settings/system-configuration.ts'
import { createPlatformManagementRoutes, type ContentGenerationDefaults } from '../platform/management-routes.ts'
import { normalizeGeneratedWorkItemTitle, workItemTitlePrompt } from '../platform/work-item-title.ts'
import { createWorkspaceRoutes } from '../platform/workspace-routes.ts'
import { NotificationService } from '../notifications/service.ts'
import { createNotificationRoutes } from '../notifications/routes.ts'
import { JobLifecycle } from '../workflows/job-lifecycle.ts'
import { CapabilityExecutionService } from '../workflows/capability-execution.ts'
import { createCapabilityRoutes } from '../workflows/capability-routes.ts'
import { AutomationRecipeService } from '../workflows/automation-recipes.ts'
import { createAutomationRoutes } from '../workflows/automation-routes.ts'
import { CoreAutomationTriggers } from '../workflows/core-automation-triggers.ts'
import { registerCoreAutomationActions } from '../workflows/core-automation-actions.ts'
import { createAutomationThreadLauncher } from '../workflows/automation-thread-launcher.ts'
import { publishAgentControlEvent, sendAgentControlCommand } from '../agents/live-control.ts'
import { agentThreadContext, mergeAgentThreadContext } from '../agents/thread-context.ts'
import { AgentResourceService, applyCustomAgentPrompt, applySkillInstructions } from '../agents/resources.ts'
import { createAgentResourceRoutes } from '../agents/resource-routes.ts'
import { CustomAgentSynchronizer } from '../agents/custom-agents.ts'
import { createDiffPreview, storedDiffSummary, summarizeDiff } from '../diff-preview.ts'
import { JobFollowUpQueue } from '../job-follow-up-queue.ts'
import { parseAgentLogEvents } from '../agent-timeline.ts'
import { DashboardReadModelStore, type DashboardReadModelEntry } from '../read-model/dashboard-read-model.ts'
import {
  runtimePROMPT_IMAGES as PROMPT_IMAGES,
  runtimeActiveJobs as activeJobs,
  runtimeAgentLaunchContext as agentLaunchContext,
  runtimeAgentLogPath as agentLogPath,
  runtimeAgentProvider as agentProvider,
  runtimeAgents as agents,
  runtimeAutomationRecipes as automationRecipes,
  runtimeCreateNotification as createNotification,
  runtimeDb as db,
  runtimeDrainingJobFollowUps as drainingJobFollowUps,
  runtimeExtensions as extensions,
  runtimeJobFollowUps as jobFollowUps,
  runtimeJobLifecycle as jobLifecycle,
  runtimeJson as json,
  runtimeNotifyClients as notifyClients,
  runtimeRequestedAgent as requestedAgent,
  runtimeResolveAgentLaunch as resolveAgentLaunch,
  runtimeRun as run,
  runtimeSpawnAgentThread as spawnAgentThread,
  runtimeSystemConfiguration as systemConfiguration,
  runtimeWork as work,
  runtimeWorkMemory as workMemory,
} from './runtime-context.ts'
import {
  runtimeAllowedBranchTypes as allowedBranchTypes,
  runtimeDrainAutomaticReviewQueue as drainAutomaticReviewQueue,
  runtimeEnsureClone as ensureClone,
  runtimeParseRepo as parseRepo,
  runtimeStartReviewSummaryFollowUp as startReviewSummaryFollowUp,
  runtimeUsesReviewWorkspace as usesReviewWorkspace,
} from './runtime-context.ts'
import {
  runtimeCleanupFailedLaunch as cleanupFailedLaunch,
  runtimeCreateAgentWorktree as createAgentWorktree,
  runtimeExtractReviewSuggestions as extractReviewSuggestions,
  runtimeLinkImplementationBranch as linkImplementationBranch,
  runtimeMonitorJobProcess as monitorJobProcess,
  runtimePostAutomaticReviewToGitHub as postAutomaticReviewToGitHub,
  runtimeUpdateReviewBatchForJob as updateReviewBatchForJob,
} from './runtime-context.ts'
import {
  runtimePersistedThreadContext as persistedThreadContext,
  runtimeThreadSummaries as threadSummaries,
  runtimePromptSelection as promptSelection,
  runtimeResolvePrompt as resolvePrompt,
  runtimeCodeReviewPrompt as codeReviewPrompt,
  runtimeTaskTarget as taskTarget,
  runtimeFindOrAddRepository as findOrAddRepository,
  runtimeDeploymentOverview as deploymentOverview,
} from './runtime-context.ts'
import { resolveEphemeralLaunch } from '../agents/ephemeral.ts'
import { createThreadRecoveryRuntime } from './thread-recovery-runtime.ts'
import { asc, eq, sql } from 'drizzle-orm'
import { jobs, repositories as repositoryTable } from '../database/schema/tables.ts'
import { jobRecord, repositoryRecord } from '../database/contract-records.ts'

function storedJob(jobId: number) {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get()
  return job ? jobRecord(job) : undefined
}
import { drainJobFollowUpQueue, followUpJob } from './follow-up-runtime.ts'
export { contextTransferTargets, drainJobFollowUpQueue, followUpInWorktree, followUpJob, retryJob } from './follow-up-runtime.ts'

export async function launchRepositoryTask(repo, title, prompt, createPr, branchType = 'feature', base = null, aiOptions: any = {}) {
  const launchOptions = { ...agentLaunchContext.getStore(), ...aiOptions }
  const runtimeAgent = agents.require(launchOptions.agentId || agentProvider)
  const jobKind = launchOptions.jobKind || 'pre_pr'
  const ephemeral = resolveEphemeralLaunch(runtimeAgent, launchOptions.ephemeral, isCodeReviewKind(jobKind))
  const readOnly = Boolean(launchOptions.readOnly)
  const workItem = work.ensureRepositoryTask(repo, title, {
    workItemId: aiOptions.workItemId,
    kind: aiOptions.workKind,
    source: aiOptions.workSource,
  })
  const workspaceMode = workItemLaunchWorkspaceMode(launchOptions.workspaceMode)
  let failedWorktree: string | null = null
  let failedBranch: string | null = null
  try {
    await ensureClone(repo)
    const origin = (await run('git', ['-C', repo.local_path, 'remote', 'get-url', 'origin'])).trim()
    if (parseRepo(origin).toLowerCase() !== repo.full_name.toLowerCase()) {
      throw new Error(`Repository origin mismatch: expected ${repo.full_name}, found ${origin}`)
    }
    let baseRef = base?.revision
    if (!baseRef) {
      try {
        baseRef = (await run('git', ['-C', repo.local_path, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
      } catch {
        for (const candidate of ['origin/main', 'origin/master']) {
          try {
            await run('git', ['-C', repo.local_path, 'rev-parse', '--verify', candidate])
            baseRef = candidate
            break
          } catch {}
        }
      }
    }
    if (!baseRef) throw new Error('Could not determine the repository default branch')
    let headSha = (await run('git', ['-C', repo.local_path, 'rev-parse', baseRef])).trim()
    let branchName: string | null = null
    if (!readOnly) {
      const taskSlug =
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'task'
      if (!allowedBranchTypes.has(branchType)) throw new Error('Choose a valid branch type')
      branchName = `${branchType}/${taskSlug}-${randomUUID().slice(0, 8)}`
    }
    const allocation = await createAgentWorktree(repo, runtimeAgent, baseRef, branchName, {
      mode: workspaceMode,
      workItemKey: launchOptions.workItemKey || workItem.key,
    })
    const { worktree, baseGitDir, sessionCwd } = allocation
    if (!allocation.created) {
      const reused = reusedCombinedWorktree(db, allocation, {
        workItemId: workItem.id,
        repositoryId: repo.id,
        repositoryName: repo.full_name,
        fallbackHeadSha: headSha,
      })
      headSha = reused.headSha
      branchName = reused.branchName
    }
    if (!readOnly && !branchName) {
      throw new Error(`${repo.full_name} does not have an implementation branch in its combined worktree`)
    }
    if (branchName) linkImplementationBranch(workItem.id, repo, branchName)
    failedWorktree = allocation.created ? worktree : null
    failedBranch = allocation.created ? branchName : null
    const baseBranch = base?.branch || baseRef.replace(/^origin\//, '')
    const publishInstruction = readOnly
      ? '\nThis is a read-only assessment. Do not modify files, create commits or branches, publish a pull request, or mutate external systems.'
      : createPr
        ? `\nWhen the requested work is complete and verified, commit it with a Conventional Commit, push branch ${branchName}, and create a draft pull request targeting ${baseBranch}. Do not stop before the draft PR has been created unless a concrete blocker requires user input.`
        : '\nDo not create or publish a pull request unless the user asks in a follow-up.'
    const sourceContext = base?.pr ? `\nStacked on pull request: #${base.pr.number} — ${base.pr.title}\nSource PR URL: ${base.pr.url}` : ''
    const continuationInstruction = readOnly
      ? 'Complete the requested assessment autonomously in this turn. Do not stop after describing a plan and do not begin implementation.'
      : launchOptions.approvalGated
        ? 'This run is approval-gated. Complete only the requested read-only decomposition in the initial turn, then ask the concrete approval question and wait. The approval requirement takes precedence over the generic autonomous-completion behavior. After explicit approval in a later turn, continue autonomously through the approved implementation and verification.'
        : 'Continue autonomously until the requested work is fully complete and verified. Progress messages, acknowledgements, and plans are not completion. End only with the completed outcome or a concrete blocking question that requires user input.'
    const workspaceDescription = `Work item workspace: ${sessionCwd}\nShared repository worktree: ${worktree}\nAssigned repository directory: ${relativeWorktreePath(sessionCwd, worktree)}`
    const workspaceInstruction =
      'Start from the Work item workspace. This Work item keeps exactly one reusable worktree per repository. Use sibling repository worktrees for cross-repository context, but make changes only in the assigned repository worktree.'
    const context = `\n\nTask: ${title}\nRepository: ${repo.full_name}\nOriginal checkout: ${repo.local_path}\n${workspaceDescription}\nBase branch: ${baseBranch}${sourceContext}\n${workspaceInstruction} The assigned worktree is linked to the original checkout through shared Git metadata.${publishInstruction}\n\n${continuationInstruction}`
    const taskPrompt = launchOptions.workSource
      ? untrustedExternalTask(prompt, `${launchOptions.workSource.provider || 'external'} ${launchOptions.workSource.kind || 'work item'}`)
      : `${agentSafetyBoundary({ fullAccess: launchOptions.permissionMode === 'full' })}\n\n${prompt.trim()}`
    const promptKind = launchOptions.workSource?.kind === 'schedule' ? 'scheduled' : 'work'
    const memoryLaunch = await workMemory.launchContext(workItem.id, `${systemConfiguration.prompt(promptKind, taskPrompt)}${context}`)
    const launch = await resolveAgentLaunch(workItem.id, memoryLaunch.prompt, runtimeAgent.id)
    const finalPrompt = launch.prompt
    const logPath = agentLogPath(workItem, repo, 'task')
    const result = db
      .insert(jobs)
      .values({
        repoId: repo.id,
        prNumber: 0,
        prompt: finalPrompt,
        worktreePath: worktree,
        sessionCwd,
        workspaceMode,
        logPath,
        status: 'starting',
        baseRepoPath: repo.local_path,
        baseGitDir,
        headSha,
        latestActivity: readOnly ? 'Preparing read-only review snapshot…' : 'Preparing task worktree…',
        activityAt: sql`CURRENT_TIMESTAMP`,
        kind: jobKind,
        taskTitle: title,
        branchName,
        workItemId: workItem.id,
        agentModel: launchOptions.model || null,
        agentReasoningEffort: launchOptions.reasoningEffort || null,
        ephemeral: ephemeral ? 1 : 0,
      })
      .run()
    const jobId = Number(result.lastInsertRowid)
    if (jobKind === 'work_review') work.attachUpfrontReviewJob(workItem.id, jobId, repo.full_name)
    else work.attachJob(workItem.id, jobId, `Started implementation thread for ${repo.full_name}`)
    const started = startMonitoredJob({
      jobId,
      logPath,
      runtimeAgent,
      userMessage: prompt,
      launch: {
        cwd: sessionCwd,
        base: repo.local_path,
        prompt: finalPrompt,
        ...launchOptions,
        ephemeral,
        writableRoots: memoryLaunch.writableRoots,
        mcpServers: launch.mcpServers,
      },
    })
    failedWorktree = null
    failedBranch = null
    return started
  } catch (error) {
    await cleanupFailedLaunch(repo.local_path, failedWorktree, failedBranch)
    work.launchFailed(workItem.id, `${repo.full_name}: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}

function userMessageEntry(text, source = 'initial') {
  return `${JSON.stringify({ time: new Date().toISOString(), event: 'user_message', text: String(text || '').trim(), source })}\n`
}

function writeUserMessage(log, text, source = 'initial') {
  if (String(text || '').trim()) log.write(userMessageEntry(text, source))
}

export function startMonitoredJob({ jobId, logPath, runtimeAgent, launch, userMessage = '' }) {
  const log = createWriteStream(logPath, { flags: 'a' })
  writeUserMessage(log, userMessage)
  const child = spawnAgentThread({ ...launch, jobId }, { cwd: launch.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }, runtimeAgent)
  monitorJobProcess(child, jobId, log, runtimeAgent)
  return storedJob(jobId)
}

export async function launchStackAnalysis(repo) {
  const runtimeAgent = requestedAgent()
  const workItem = work.create({
    title: `Analyze PR stacks in ${repo.full_name}`,
    kind: 'investigation',
    repositoryId: repo.id,
  })
  await ensureClone(repo)
  await run('git', ['-C', repo.local_path, 'fetch', 'origin', '--prune'])
  let baseRef
  try {
    baseRef = (await run('git', ['-C', repo.local_path, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
  } catch {
    for (const candidate of ['origin/main', 'origin/master']) {
      try {
        await run('git', ['-C', repo.local_path, 'rev-parse', '--verify', candidate])
        baseRef = candidate
        break
      } catch {}
    }
  }
  if (!baseRef) throw new Error('Could not determine the repository default branch')
  const headSha = (await run('git', ['-C', repo.local_path, 'rev-parse', baseRef])).trim()
  const { worktree, baseGitDir, sessionCwd } = await createAgentWorktree(repo, runtimeAgent, headSha, null, {
    mode: 'combined',
    workItemKey: workItem.key,
    isolationKey: `stack-analysis-${randomUUID().slice(0, 8)}`,
  })
  const prompt = `Analyze all open pull requests in ${repo.full_name} and produce a private PR stacking report.

Use the authenticated GitHub CLI and local git data in read-only ways to inspect every open PR's base and head branches, commits, changed files, diffs, descriptions, linked issues, discussions, reviews, and checks. Identify PRs that are already stacked, PRs that logically or technically depend on one another but are not stacked, overlapping work that should remain independent, and cycles or risky ordering. Infer dependencies only when supported by concrete evidence; distinguish confirmed dependencies from recommendations.

Return:
1. A concise overview.
2. Confirmed stacks in base-to-tip merge order.
3. Recommended stacks, with the proposed base PR/branch and evidence for every relationship.
4. PRs that should remain independent despite overlap.
5. Risks, pending GitHub Actions, and the safest merge order.

At the very end, append a machine-readable task manifest using exactly this format:
<!-- PR_TASKS_JSON
[{"pr_number":123,"title":"Short actionable task","rationale":"Concrete dependency evidence and next action","recommended_base":"branch-or-null"}]
-->
Include one entry for every PR that has a concrete stacking, base-change, sequencing, or readiness action. Use valid JSON, real PR numbers, and null when no base change is recommended. Do not put Markdown fences around the manifest.

This analysis is private and strictly read-only. Do not edit files, push branches, change PR bases, post comments, rerun workflows, or mutate GitHub in any way. End with a Markdown report; do not stop at a plan.`
  const memoryLaunch = await workMemory.launchContext(workItem.id, systemConfiguration.prompt('review', prompt))
  const launch = await resolveAgentLaunch(workItem.id, memoryLaunch.prompt, runtimeAgent.id)
  const finalPrompt = launch.prompt
  const logPath = agentLogPath(workItem, repo, 'stack-analysis')
  const result = db
    .insert(jobs)
    .values({
      repoId: repo.id,
      prNumber: 0,
      prompt: finalPrompt,
      worktreePath: worktree,
      sessionCwd,
      workspaceMode: 'combined',
      logPath,
      status: 'starting',
      baseRepoPath: repo.local_path,
      baseGitDir,
      headSha,
      latestActivity: 'Analyzing PR relationships…',
      activityAt: sql`CURRENT_TIMESTAMP`,
      kind: 'stack_analysis',
      taskTitle: 'PR stack analysis',
      workItemId: workItem.id,
    })
    .run()
  const jobId = Number(result.lastInsertRowid)
  work.attachJob(workItem.id, jobId, 'Started PR stack analysis')
  const log = createWriteStream(logPath, { flags: 'a' })
  writeUserMessage(log, prompt)
  const child = spawnAgentThread(
    {
      jobId,
      cwd: sessionCwd,
      base: repo.local_path,
      prompt: finalPrompt,
      reviewMode: true,
      writableRoots: memoryLaunch.writableRoots,
      mcpServers: launch.mcpServers,
    },
    {
      cwd: sessionCwd,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  monitorJobProcess(child, jobId, log)
  return storedJob(jobId)
}

export async function launchPlanningWorkflow(request: PlanningWorkflowRequest) {
  const { repositories } = request
  const runtimeAgent = requestedAgent()
  const storedHost = db.select().from(repositoryTable).orderBy(asc(repositoryTable.id)).limit(1).get()
  const host = repositories[0] || (storedHost ? repositoryRecord(storedHost) : undefined)
  if (!host) throw new Error('Add at least one repository before preparing work')
  const workItem = work.create({
    title: request.title.slice(0, 200),
    kind: 'investigation',
    repositoryId: host.id,
    source: request.source,
  })
  const workspaceMode = workItemLaunchWorkspaceMode(request.workspaceMode)
  let failedWorktree: string | null = null
  try {
    await ensureClone(host)
    await run('git', ['-C', host.local_path, 'fetch', 'origin', '--prune'])
    let baseRef
    try {
      baseRef = (await run('git', ['-C', host.local_path, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
    } catch {}
    if (!baseRef) baseRef = 'HEAD'
    const headSha = (await run('git', ['-C', host.local_path, 'rev-parse', baseRef])).trim()
    const { worktree, baseGitDir, sessionCwd } = await createAgentWorktree(host, runtimeAgent, headSha, null, {
      mode: workspaceMode,
      workItemKey: workItem.key,
    })
    failedWorktree = worktree
    const workspaceContext = `\n\nWork item workspace: ${sessionCwd}\nAssigned repository worktree: ${worktree}\nStart from the Work item workspace. Treat sibling repository worktrees as read-only context and keep this planning task read-only.`
    const memoryLaunch = await workMemory.launchContext(
      workItem.id,
      systemConfiguration.prompt('planning', `${request.prompt}${workspaceContext}`),
    )
    const launch = await resolveAgentLaunch(workItem.id, memoryLaunch.prompt, runtimeAgent.id)
    const finalPrompt = launch.prompt
    const logPrefix =
      String(request.logPrefix || 'planning')
        .replace(/[^a-z0-9-]/gi, '-')
        .slice(0, 60) || 'planning'
    const logPath = agentLogPath(workItem, host, logPrefix)
    const result = db
      .insert(jobs)
      .values({
        repoId: host.id,
        prNumber: 0,
        prompt: finalPrompt,
        worktreePath: worktree,
        sessionCwd,
        workspaceMode,
        logPath,
        status: 'starting',
        baseRepoPath: host.local_path,
        baseGitDir,
        headSha,
        latestActivity: request.activity,
        activityAt: sql`CURRENT_TIMESTAMP`,
        kind: request.jobKind,
        taskTitle: request.taskTitle,
        workItemId: workItem.id,
      })
      .run()
    const jobId = Number(result.lastInsertRowid)
    const log = createWriteStream(logPath, { flags: 'a' })
    writeUserMessage(log, request.prompt)
    work.attachJob(workItem.id, jobId, request.activity)
    const child = spawnAgentThread(
      {
        jobId,
        cwd: sessionCwd,
        base: host.local_path,
        prompt: finalPrompt,
        reviewMode: true,
        writableRoots: memoryLaunch.writableRoots,
        mcpServers: launch.mcpServers,
      },
      { cwd: sessionCwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    monitorJobProcess(child, jobId, log)
    failedWorktree = null
    return storedJob(jobId)
  } catch (error) {
    await cleanupFailedLaunch(host.local_path, failedWorktree)
    work.launchFailed(workItem.id, error)
    throw error
  }
}

export async function refinePlanningWorkflow(request: PlanningRefinementRequest) {
  const { job } = request
  const runtimeAgent = agents.require(job.agent_id || agentProvider)
  const sessionCwd = jobSessionCwd(job, runtimeAgent.workspaceRoot)
  await stat(job.worktree_path)
  await stat(sessionCwd)
  const configuredPrompt = systemConfiguration.prompt('planning', request.prompt)
  const memoryLaunch = job.work_item_id
    ? await workMemory.launchContext(job.work_item_id, configuredPrompt)
    : { prompt: configuredPrompt, writableRoots: [] }
  const log = createWriteStream(job.log_path, { flags: 'a' })
  log.write(
    `${JSON.stringify({
      time: new Date().toISOString(),
      event: 'follow_up_started',
      source_event: request.event,
      thread_id: job.thread_id,
      prompt: memoryLaunch.prompt,
      display_prompt: request.prompt,
    })}\n`,
  )
  const child = spawnAgentThread(
    {
      jobId: job.id,
      cwd: sessionCwd,
      base: job.base_repo_path,
      resume: job.thread_id,
      prompt: memoryLaunch.prompt,
      reviewMode: true,
      writableRoots: memoryLaunch.writableRoots,
    },
    { cwd: sessionCwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    runtimeAgent,
  )
  jobLifecycle.markStarting(job.id, request.activity, { clearResult: true })
  monitorJobProcess(child, job.id, log, runtimeAgent)
  return storedJob(job.id)
}

export async function forkThreadJob(source, title, prompt, base, branchType) {
  const runtimeAgent = agents.require(source.agent_id || agentProvider)
  const storedRepository = db.select().from(repositoryTable).where(eq(repositoryTable.id, source.repo_id)).get()
  const repo = storedRepository ? repositoryRecord(storedRepository) : null
  if (!repo) throw new Error('Repository not found')
  const workItem = work.create({ title, kind: 'implementation', repositoryId: repo.id })
  if (source.work_item_id) {
    work.relate(workItem.id, source.work_item_id, 'parent')
    work.relate(source.work_item_id, workItem.id, 'child')
  }
  await ensureClone(repo)
  if (!source.thread_id) throw new Error(`This run has no ${runtimeAgent.name} thread to fork`)
  if (source.ephemeral) throw new Error('Ephemeral runs cannot be forked because their provider session is not retained')
  if (['starting', 'running'].includes(source.status))
    throw new Error(`Wait for the current ${runtimeAgent.name} turn to finish before forking`)
  if (!allowedBranchTypes.has(branchType)) throw new Error('Choose a valid branch type')
  let baseRef
  let baseBranch
  if (base === 'current') {
    await stat(source.worktree_path)
    baseRef = (await run('git', ['-C', source.worktree_path, 'rev-parse', 'HEAD'])).trim()
    baseBranch =
      source.branch_name || (await run('git', ['-C', source.worktree_path, 'branch', '--show-current'])).trim() || baseRef.slice(0, 12)
  } else if (base === 'main') {
    await run('git', ['-C', repo.local_path, 'fetch', 'origin', '--prune'])
    try {
      baseRef = (await run('git', ['-C', repo.local_path, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
    } catch {
      for (const candidate of ['origin/main', 'origin/master']) {
        try {
          await run('git', ['-C', repo.local_path, 'rev-parse', '--verify', candidate])
          baseRef = candidate
          break
        } catch {}
      }
    }
    if (!baseRef) throw new Error('Could not determine the repository default branch')
    baseBranch = baseRef.replace(/^origin\//, '')
  } else throw new Error('Choose current branch or main as the fork base')
  const headSha = (await run('git', ['-C', repo.local_path, 'rev-parse', baseRef])).trim()
  const taskSlug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'fork'
  const branchName = `${branchType}/${taskSlug}-${randomUUID().slice(0, 8)}`
  linkImplementationBranch(workItem.id, repo, branchName)
  const workspaceMode = workItemLaunchWorkspaceMode(undefined)
  const { worktree, baseGitDir, sessionCwd } = await createAgentWorktree(repo, runtimeAgent, headSha, branchName, {
    mode: workspaceMode,
    workItemKey: workItem.key,
  })
  const workspaceContext = `Work item workspace: ${sessionCwd}\nAssigned repository worktree: ${worktree}`
  const context = `\n\nForked task: ${title}\nRepository: ${repo.full_name}\n${workspaceContext}\nBase branch: ${baseBranch}\nTask branch: ${branchName}\nThis thread inherits the completed conversation history from its source. Work only in the assigned repository worktree; do not modify the source worktree.\n\nContinue autonomously until the requested work is fully complete and verified. End only with the completed outcome or a concrete blocking question that requires user input.`
  const memoryLaunch = await workMemory.launchContext(workItem.id, `${prompt.trim()}${context}`)
  const launch = await resolveAgentLaunch(workItem.id, memoryLaunch.prompt, runtimeAgent.id)
  const finalPrompt = launch.prompt
  const logPath = agentLogPath(workItem, repo, 'fork')
  const result = db
    .insert(jobs)
    .values({
      repoId: repo.id,
      prNumber: 0,
      prompt: finalPrompt,
      worktreePath: worktree,
      sessionCwd,
      workspaceMode,
      logPath,
      status: 'starting',
      baseRepoPath: repo.local_path,
      baseGitDir,
      headSha,
      latestActivity: `Forking ${runtimeAgent.name} thread…`,
      activityAt: sql`CURRENT_TIMESTAMP`,
      kind: 'pre_pr',
      sourceJobId: source.id,
      taskTitle: title,
      branchName,
      workItemId: workItem.id,
    })
    .run()
  const jobId = Number(result.lastInsertRowid)
  work.attachJob(workItem.id, jobId, `Forked from ${source.work_item_id ? `work item #${source.work_item_id}` : `run #${source.id}`}`)
  const log = createWriteStream(logPath, { flags: 'a' })
  writeUserMessage(log, prompt)
  const child = spawnAgentThread(
    {
      jobId,
      cwd: sessionCwd,
      base: repo.local_path,
      fork: source.thread_id,
      prompt: finalPrompt,
      writableRoots: memoryLaunch.writableRoots,
      mcpServers: launch.mcpServers,
    },
    {
      cwd: sessionCwd,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
    runtimeAgent,
  )
  monitorJobProcess(child, jobId, log, runtimeAgent)
  return storedJob(jobId)
}

export function withAgentMetadata(job) {
  const runtimeAgent = agents.get(job.agent_id || agentProvider)
  const moduleCatalog = extensions.catalog().filter(({ enabled }) => enabled)
  const agentPresentation = moduleCatalog
    .flatMap(({ agents: declaredAgents }) => declaredAgents || [])
    .find(({ id }) => id === (job.agent_id || agentProvider))
  const runKind = moduleCatalog.flatMap(({ ui }) => ui?.runKinds || []).find(({ kind }) => kind === job.kind)
  return {
    ...job,
    agent_name: runtimeAgent?.name || job.agent_id || 'Agent',
    thread_url: job.thread_id && !job.ephemeral ? runtimeAgent?.threadUrl?.(job.thread_id) || null : null,
    can_steer: Boolean(runtimeAgent?.supportsLiveSteering) && (!job.ephemeral || ['starting', 'running'].includes(job.status)),
    agent_accent: agentPresentation?.accent || 'neutral',
    ...(runKind
      ? {
          kind_label: runKind.label,
          kind_title_fallback: runKind.titleFallback || null,
          kind_tone: runKind.tone || 'neutral',
        }
      : {}),
  }
}

function liveSteeringAgent(job) {
  const runtimeAgent = agents.require(job.agent_id || agentProvider)
  if (!runtimeAgent.supportsLiveSteering) throw new Error(`${runtimeAgent.name} does not support live steering`)
  return runtimeAgent
}

function validateSteeringState(job, runtimeAgent) {
  if (!['starting', 'running'].includes(job.status)) throw new Error('This work thread is no longer running; send a follow-up instead')
  if (job.input_questions) throw new Error(`Answer the pending ${runtimeAgent.name} question before steering`)
  if (!job.thread_id) throw new Error(`Wait for the ${runtimeAgent.name} thread to finish starting`)
}

function liveSteeringChild(job, runtimeAgent) {
  validateSteeringState(job, runtimeAgent)
  const child = activeJobs.get(job.id)
  if (!child?.stdin?.writable) throw new Error(`The live ${runtimeAgent.name} connection is no longer available`)
  return child
}

async function steerWorkThread(job, prompt) {
  const runtimeAgent = liveSteeringAgent(job)
  const child = liveSteeringChild(job, runtimeAgent)
  const result = await sendAgentControlCommand(child, {
    type: 'steer',
    command_id: randomUUID(),
    prompt: localizePromptImages(prompt, PROMPT_IMAGES),
  })
  await appendFile(job.log_path, userMessageEntry(prompt, 'steer'))
  return result
}

export async function steerResponse(job, prompt) {
  try {
    const result = await steerWorkThread(job, prompt)
    return json(202, {
      accepted: true,
      turn_id: result.turn_id || null,
      ...persistedThreadContext(job.id),
    })
  } catch (error) {
    return json(409, { error: error instanceof Error ? error.message : String(error) })
  }
}

const threadRecoveryRuntime = createThreadRecoveryRuntime({ followUpJob, drainJobFollowUpQueue })
export const { startThreadRecoveryTimers } = threadRecoveryRuntime

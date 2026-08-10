import { randomUUID } from 'node:crypto'
import type { ArchitectureIndex, CapabilityExecution, CapabilityValue, ImpactAnalysis, ValidationRun } from '@vertexade/platform-contracts'
import { HttpError, readJsonObject } from '@vertexade/platform-server/http'
import { HttpRouter } from '@vertexade/platform-server/router'
import type { CapabilityExecutionService } from '../workflows/capability-execution.ts'
import { architectureIndexCapabilityId, impactAnalysisCapabilityId, validationCapabilityId } from './capabilities.ts'
import type { ArchitectureContextService, ResolvedArchitectureIndexInput } from './architecture-service.ts'
import type { ImpactAnalysisService, ResolvedImpactAnalysisInput } from './impact-service.ts'
import type { ValidationIntelligenceService } from './validation-service.ts'
import type { PullRequestEvidenceService } from './evidence-service.ts'
import type { ValidationRepairLoopService } from './repair-loop-service.ts'

export type ValidationRepairLauncher = (input: {
  run: ValidationRun
  title: string
  prompt: string
  linkedWorkItemId: number | null
}) => Promise<{ id: number; work_item_id?: number | null }>

function positiveInteger(value: unknown, label: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) throw new HttpError(`${label} must be a positive integer`, 400)
  return result
}

function outputRecord(value: CapabilityValue | null): Record<string, CapabilityValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, CapabilityValue>) : null
}

function executionFailure(execution: CapabilityExecution, operation = 'Capability execution'): Response {
  const status = execution.status === 'cancelled' ? 409 : execution.status === 'timed-out' ? 504 : 422
  return Response.json(
    {
      error: execution.error || `${operation} failed`,
      execution,
    },
    { status },
  )
}

async function executeValidation(
  validation: ValidationIntelligenceService,
  executions: CapabilityExecutionService,
  input: { repositoryId: number; impactAnalysisId: number; targetId: string; parentRunId?: number | null },
  requestId: string,
): Promise<ValidationRun> {
  const execution = await executions.execute('action', validationCapabilityId, input, {
    idempotencyKey: `validation:${input.repositoryId}:${input.impactAnalysisId}:${input.targetId}:${input.parentRunId || 'root'}:${requestId}`,
    context: { entityKind: 'repository', entityKey: String(input.repositoryId) },
  })
  if (execution.status !== 'succeeded') {
    const status = execution.status === 'cancelled' ? 409 : execution.status === 'timed-out' ? 504 : 422
    throw new HttpError(execution.error || 'Validation failed', status)
  }
  const output = outputRecord(execution.output)
  const runId = Number(output?.runId)
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new HttpError('Validation returned an invalid result', 500)
  return validation.attachExecution(runId, execution.id)
}

async function executeImpact(
  input: ResolvedImpactAnalysisInput,
  impact: ImpactAnalysisService,
  executions: CapabilityExecutionService,
): Promise<Response> {
  const analysis = await executeImpactValue(input, impact, executions)
  return Response.json(analysis, { status: 201 })
}

async function executeImpactValue(
  input: ResolvedImpactAnalysisInput,
  impact: ImpactAnalysisService,
  executions: CapabilityExecutionService,
): Promise<ImpactAnalysis> {
  const execution = await executions.execute('query', impactAnalysisCapabilityId, input, {
    idempotencyKey: impact.idempotencyKey(input),
    context: {
      entityKind: input.subject.kind === 'pull_request' ? 'pull_request' : 'repository',
      entityKey:
        input.subject.kind === 'pull_request'
          ? `${input.subject.repositoryId}#${input.subject.pullRequestNumber}`
          : String(input.subject.repositoryId),
    },
  })
  if (execution.status !== 'succeeded') {
    const status = execution.status === 'cancelled' ? 409 : execution.status === 'timed-out' ? 504 : 422
    throw new HttpError(execution.error || 'Impact analysis failed', status)
  }
  const output = outputRecord(execution.output)
  const analysisId = Number(output?.analysisId)
  if (!Number.isSafeInteger(analysisId) || analysisId <= 0) throw new HttpError('Impact analysis returned an invalid result', 500)
  return impact.attachExecution(analysisId, execution.id)
}

async function executeArchitectureIndex(
  input: ResolvedArchitectureIndexInput,
  architecture: ArchitectureContextService,
  executions: CapabilityExecutionService,
): Promise<ArchitectureIndex> {
  const execution = await executions.execute('query', architectureIndexCapabilityId, input, {
    idempotencyKey: architecture.idempotencyKey(input),
    context: { entityKind: 'repository', entityKey: String(input.repositoryId) },
  })
  if (execution.status !== 'succeeded') {
    const status = execution.status === 'cancelled' ? 409 : execution.status === 'timed-out' ? 504 : 422
    throw new HttpError(execution.error || 'Architecture indexing failed', status)
  }
  const output = outputRecord(execution.output)
  const indexId = Number(output?.indexId)
  if (!Number.isSafeInteger(indexId) || indexId <= 0) throw new HttpError('Architecture indexing returned an invalid result', 500)
  return architecture.attachExecution(indexId, execution.id)
}

export function createDevelopmentRoutes(
  impact: ImpactAnalysisService,
  architecture: ArchitectureContextService,
  validation: ValidationIntelligenceService,
  evidence: PullRequestEvidenceService,
  executions: CapabilityExecutionService,
  launchRepair: ValidationRepairLauncher,
  repairLoops?: ValidationRepairLoopService,
): HttpRouter {
  const router = new HttpRouter()

  router.get('/api/repositories/:repositoryId/impact-analyses', (request, { params }) => {
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const limit = Number(new URL(request.url).searchParams.get('limit') || 20)
    return Response.json({ analyses: impact.list(repositoryId, Number.isFinite(limit) ? limit : 20) })
  })

  router.get('/api/repositories/:repositoryId/impact-analyses/:analysisId', (_request, { params }) => {
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const value = impact.get(positiveInteger(params.analysisId, 'Impact analysis ID'))
    if (!value || value.subject.repositoryId !== repositoryId) throw new HttpError('Impact analysis not found', 404)
    return Response.json(value)
  })

  router.get('/api/repositories/:repositoryId/impact-analyses/:analysisId/feedback', (_request, { params }) => {
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const analysisId = positiveInteger(params.analysisId, 'Impact analysis ID')
    const analysis = impact.get(analysisId)
    if (!analysis || analysis.subject.repositoryId !== repositoryId) throw new HttpError('Impact analysis not found', 404)
    return Response.json({ feedback: impact.feedback(analysisId) })
  })

  router.post('/api/repositories/:repositoryId/impact-analyses/:analysisId/feedback', async (request, { params }) => {
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const analysisId = positiveInteger(params.analysisId, 'Impact analysis ID')
    const analysis = impact.get(analysisId)
    if (!analysis || analysis.subject.repositoryId !== repositoryId) throw new HttpError('Impact analysis not found', 404)
    return Response.json(impact.addFeedback(analysisId, await readJsonObject(request)), { status: 201 })
  })

  router.post('/api/repositories/:repositoryId/impact-analyses', async (request, { params }) => {
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const input = await readJsonObject(request)
    const prepared = await impact.prepareRepositoryComparison(repositoryId, input.baseRevision, input.headRevision, request.signal)
    return executeImpact(prepared, impact, executions)
  })

  router.get('/api/pulls/:repositoryId/:pullRequestNumber/impact-analysis', (_request, { params }) => {
    const value = impact.latestForPullRequest(
      positiveInteger(params.repositoryId, 'Repository ID'),
      positiveInteger(params.pullRequestNumber, 'Pull-request number'),
    )
    return Response.json({ analysis: value })
  })

  router.post('/api/pulls/:repositoryId/:pullRequestNumber/impact-analysis', async (request, { params }) => {
    const prepared = await impact.preparePullRequest(
      positiveInteger(params.repositoryId, 'Repository ID'),
      positiveInteger(params.pullRequestNumber, 'Pull-request number'),
      request.signal,
    )
    return executeImpact(prepared, impact, executions)
  })

  router.get('/api/work-items/:workItemId/impact-analysis', (_request, { params }) => {
    return Response.json({ analysis: impact.latestForWorkItem(positiveInteger(params.workItemId, 'Work item ID')) })
  })

  router.post('/api/work-items/:workItemId/impact-analysis', async (request, { params }) => {
    const prepared = await impact.prepareWorkItem(positiveInteger(params.workItemId, 'Work item ID'), request.signal)
    return executeImpact(prepared, impact, executions)
  })

  router.get('/api/repositories/:repositoryId/architecture-index', async (request, { params }) => {
    return Response.json({
      index: await architecture.latestIndexWithFreshness(positiveInteger(params.repositoryId, 'Repository ID'), request.signal),
    })
  })

  router.get('/api/repositories/:repositoryId/architecture-index/:indexId', (_request, { params }) => {
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const value = architecture.getIndex(positiveInteger(params.indexId, 'Architecture index ID'))
    if (!value || value.subject.repositoryId !== repositoryId) throw new HttpError('Architecture index not found', 404)
    return Response.json(value)
  })

  router.post('/api/repositories/:repositoryId/architecture-index', async (request, { params }) => {
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const input = await readJsonObject(request)
    const prepared = await architecture.prepareIndex(repositoryId, input.revision || 'HEAD', request.signal)
    return Response.json(await executeArchitectureIndex(prepared, architecture, executions), { status: 201 })
  })

  router.get('/api/pulls/:repositoryId/:pullRequestNumber/architecture-context', async (request, { params }) => {
    const subject = await architecture.preparePullRequestSubject(
      positiveInteger(params.repositoryId, 'Repository ID'),
      positiveInteger(params.pullRequestNumber, 'Pull-request number'),
      request.signal,
    )
    return Response.json({ packet: architecture.latestContextPacket(subject) })
  })

  router.post('/api/pulls/:repositoryId/:pullRequestNumber/architecture-context', async (request, { params }) => {
    const subject = await architecture.preparePullRequestSubject(
      positiveInteger(params.repositoryId, 'Repository ID'),
      positiveInteger(params.pullRequestNumber, 'Pull-request number'),
      request.signal,
    )
    const input = await readJsonObject(request)
    const existing = architecture.indexForRevision(subject.repositoryId, subject.headRevision)
    const index =
      existing ||
      (await executeArchitectureIndex({ repositoryId: subject.repositoryId, revision: subject.headRevision }, architecture, executions))
    const focusPaths = architecture.focusPathsForSubject(subject, input.focusPaths)
    return Response.json(
      architecture.createContextPacket({
        indexId: index.id,
        subject,
        focusPaths,
        byteBudget: Number(input.byteBudget) || 32_000,
      }),
      { status: 201 },
    )
  })

  router.get('/api/repositories/:repositoryId/test-target-overrides', (_request, { params }) => {
    return Response.json({ targets: validation.overrides(positiveInteger(params.repositoryId, 'Repository ID')) })
  })

  router.post('/api/repositories/:repositoryId/test-target-overrides', async (request, { params }) => {
    const input = await readJsonObject(request)
    return Response.json({ targets: validation.replaceOverrides(positiveInteger(params.repositoryId, 'Repository ID'), input.targets) })
  })

  router.get('/api/pulls/:repositoryId/:pullRequestNumber/test-intelligence', async (request, { params }) => {
    return Response.json(
      await validation.pullRequestIntelligence(
        positiveInteger(params.repositoryId, 'Repository ID'),
        positiveInteger(params.pullRequestNumber, 'Pull-request number'),
        request.signal,
      ),
    )
  })

  router.post('/api/pulls/:repositoryId/:pullRequestNumber/validation-runs', async (request, { params }) => {
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const pullRequestNumber = positiveInteger(params.pullRequestNumber, 'Pull-request number')
    const intelligence = await validation.pullRequestIntelligence(repositoryId, pullRequestNumber, request.signal)
    if (!intelligence.analysis || !intelligence.selection) {
      throw new HttpError('Run impact analysis before starting validation', 409)
    }
    const input = await readJsonObject(request)
    const requestedIds = Array.isArray(input.targetIds)
      ? input.targetIds.map(String)
      : intelligence.selection.selected.map((target) => target.id)
    if (!requestedIds.length || requestedIds.length > 50 || new Set(requestedIds).size !== requestedIds.length) {
      throw new HttpError('Select between 1 and 50 unique validation targets', 400)
    }
    const allowedIds = new Set(intelligence.selection.selected.map((target) => target.id))
    if (requestedIds.some((targetId) => !allowedIds.has(targetId))) {
      throw new HttpError('A requested target is not selected for the current impact analysis', 400)
    }
    const requestId = String(input.requestId || randomUUID())
    if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(requestId)) throw new HttpError('Request ID is invalid', 400)
    const runs: ValidationRun[] = []
    const errors: Array<{ targetId: string; message: string }> = []
    for (const targetId of requestedIds) {
      try {
        runs.push(
          await executeValidation(
            validation,
            executions,
            { repositoryId, impactAnalysisId: intelligence.analysis.id, targetId },
            requestId,
          ),
        )
      } catch (error) {
        errors.push({ targetId, message: error instanceof Error ? error.message : String(error || 'Validation failed') })
      }
    }
    return Response.json({ runs, errors }, { status: runs.length ? 201 : 422 })
  })

  router.get('/api/repositories/:repositoryId/validation-runs/:runId', (_request, { params }) => {
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const run = validation.getRun(positiveInteger(params.runId, 'Validation run ID'))
    if (!run || run.repositoryId !== repositoryId) throw new HttpError('Validation run not found', 404)
    return Response.json(run)
  })

  router.get('/api/repositories/:repositoryId/validation-runs/:runId/log', (_request, { params }) => {
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const run = validation.getRun(positiveInteger(params.runId, 'Validation run ID'))
    if (!run || run.repositoryId !== repositoryId) throw new HttpError('Validation run not found', 404)
    const log = validation.runOutput(run.id)
    if (!log) throw new HttpError('Validation log not found', 404)
    return Response.json(log)
  })

  router.post('/api/repositories/:repositoryId/validation-runs/:runId/repair', async (_request, { params }) => {
    try {
      const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
      const repair = validation.repairPrompt(positiveInteger(params.runId, 'Validation run ID'))
      if (repair.run.repositoryId !== repositoryId) throw new HttpError('Validation run not found', 404)
      if (repairLoops?.getByRootRun(repair.run.id)) throw new HttpError('This validation run already has a bounded repair loop', 409)
      if (repair.run.repairJobId) return Response.json(repair.run)
      const job = await launchRepair({
        ...repair,
        linkedWorkItemId: validation.linkedWorkItemId(repair.run.id),
      })
      return Response.json(validation.attachRepair(repair.run.id, job), { status: 201 })
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(error instanceof Error ? error.message : 'Repair Work could not be started', 422)
    }
  })

  router.get('/api/repositories/:repositoryId/validation-runs/:runId/repair-loop', (_request, { params }) => {
    if (!repairLoops) throw new HttpError('Bounded repair loops are unavailable', 503)
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const run = validation.getRun(positiveInteger(params.runId, 'Validation run ID'))
    if (!run || run.repositoryId !== repositoryId) throw new HttpError('Validation run not found', 404)
    return Response.json({ loop: repairLoops.getByRootRun(run.id) })
  })

  router.post('/api/repositories/:repositoryId/validation-runs/:runId/repair-loop', async (request, { params }) => {
    if (!repairLoops) throw new HttpError('Bounded repair loops are unavailable', 503)
    try {
      const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
      const run = validation.getRun(positiveInteger(params.runId, 'Validation run ID'))
      if (!run || run.repositoryId !== repositoryId) throw new HttpError('Validation run not found', 404)
      return Response.json(await repairLoops.start(run.id, await readJsonObject(request)), { status: 201 })
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(error instanceof Error ? error.message : 'Repair loop could not be started', 422)
    }
  })

  router.post('/api/repositories/:repositoryId/validation-runs/:runId/repair-loop/cancel', (_request, { params }) => {
    if (!repairLoops) throw new HttpError('Bounded repair loops are unavailable', 503)
    const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
    const run = validation.getRun(positiveInteger(params.runId, 'Validation run ID'))
    if (!run || run.repositoryId !== repositoryId) throw new HttpError('Validation run not found', 404)
    return Response.json(repairLoops.cancel(run.id))
  })

  router.post('/api/repositories/:repositoryId/validation-runs/:runId/repair/verify', async (request, { params }) => {
    try {
      const repositoryId = positiveInteger(params.repositoryId, 'Repository ID')
      const runId = positiveInteger(params.runId, 'Validation run ID')
      const original = validation.getRun(runId)
      if (!original || original.repositoryId !== repositoryId) throw new HttpError('Validation run not found', 404)
      const workItemId = validation.repairWorkItemReady(runId)
      const prepared = await impact.prepareWorkItem(workItemId, request.signal)
      const analysis = await executeImpactValue(prepared, impact, executions)
      const current = await validation.intelligenceForImpact(analysis.id, request.signal)
      if (!current.catalog || !current.selection) throw new Error('Repair impact did not produce a validation catalog')
      const rerunTarget = current.catalog.targets.find((target) => target.id === original.target.id && target.enabled)
      if (!rerunTarget) throw new Error('The failed target is no longer present in the trusted validation catalog')
      const previous = await validation.intelligenceForImpact(original.impactAnalysisId, request.signal)
      const previousTargetIds = new Set(previous.selection?.selected.map((target) => target.id) || [])
      const broaderImpact = current.selection.selected.some((target) => !previousTargetIds.has(target.id))
      const input = await readJsonObject(request)
      const requestId = String(input.requestId || randomUUID())
      if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(requestId)) throw new HttpError('Request ID is invalid', 400)
      const runs: ValidationRun[] = []
      const first = await executeValidation(
        validation,
        executions,
        { repositoryId, impactAnalysisId: analysis.id, targetId: rerunTarget.id, parentRunId: original.id },
        `${requestId}:failed-target`,
      )
      runs.push(first)
      const repeatedFingerprint = first.failures.some((failure) =>
        original.failures.some((candidate) => candidate.fingerprint === failure.fingerprint),
      )
      let stoppedReason: 'failed_target' | 'repeated_fingerprint' | 'broader_impact' | null = null
      if (first.status !== 'passed') stoppedReason = repeatedFingerprint ? 'repeated_fingerprint' : 'failed_target'
      else if (broaderImpact) stoppedReason = 'broader_impact'
      if (!stoppedReason) {
        for (const target of current.selection.selected.filter((target) => target.id !== rerunTarget.id)) {
          const validationRun = await executeValidation(
            validation,
            executions,
            { repositoryId, impactAnalysisId: analysis.id, targetId: target.id, parentRunId: original.id },
            `${requestId}:${target.id}`,
          )
          runs.push(validationRun)
          if (validationRun.status !== 'passed') {
            stoppedReason = validationRun.failures.some((failure) =>
              original.failures.some((candidate) => candidate.fingerprint === failure.fingerprint),
            )
              ? 'repeated_fingerprint'
              : 'failed_target'
            break
          }
        }
      }
      return Response.json({ analysis, runs, stoppedReason, broaderImpact }, { status: 201 })
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(error instanceof Error ? error.message : 'Repair verification failed', 422)
    }
  })

  router.get('/api/pulls/:repositoryId/:pullRequestNumber/evidence', (_request, { params }) => {
    return Response.json({
      snapshot: evidence.latest(
        positiveInteger(params.repositoryId, 'Repository ID'),
        positiveInteger(params.pullRequestNumber, 'Pull-request number'),
      ),
    })
  })

  router.post('/api/pulls/:repositoryId/:pullRequestNumber/evidence', async (_request, { params }) => {
    return Response.json(
      await evidence.collect(
        positiveInteger(params.repositoryId, 'Repository ID'),
        positiveInteger(params.pullRequestNumber, 'Pull-request number'),
      ),
      { status: 201 },
    )
  })

  router.post('/api/pulls/:repositoryId/:pullRequestNumber/evidence/waivers', async (request, { params }) => {
    const input = await readJsonObject(request)
    return Response.json(
      await evidence.addWaiver(
        positiveInteger(params.repositoryId, 'Repository ID'),
        positiveInteger(params.pullRequestNumber, 'Pull-request number'),
        input,
      ),
      { status: 201 },
    )
  })

  router.get('/api/repositories/:repositoryId/evidence-policy', (_request, { params }) => {
    return Response.json(evidence.policy(positiveInteger(params.repositoryId, 'Repository ID')))
  })

  router.post('/api/repositories/:repositoryId/evidence-policy', async (request, { params }) => {
    return Response.json(evidence.updatePolicy(positiveInteger(params.repositoryId, 'Repository ID'), await readJsonObject(request)))
  })

  return router
}

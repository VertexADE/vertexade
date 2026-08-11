import { createHash } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import type {
  DevelopmentSubject,
  ImpactAnalysis,
  ImpactAnalysisFeedback,
  ImpactAnalysisListItem,
  ImpactAnalysisResult,
} from '@vertexade/platform-contracts'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { impactAnalyses, impactAnalysisFeedback } from '../database/schema/development-tables.ts'
import { jobs, pullRequests, repositories } from '../database/schema/tables.ts'
import {
  analyzeRepositoryImpact,
  impactAnalyzerVersion,
  type ImpactAnalyzerRepository,
  type ImpactCommandRunner,
} from './impact-analyzer.ts'

export type ResolvedImpactAnalysisInput = {
  subject: DevelopmentSubject
}

type ImpactAnalysisRow = typeof impactAnalyses.$inferSelect

function positiveInteger(value: unknown, label: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${label} must be a positive integer`)
  return result
}

function revision(value: unknown, label: string): string {
  const result = String(value ?? '').trim()
  if (!result || result.length > 255 || result.startsWith('-') || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error(`${label} must be a valid Git revision with 1–255 characters`)
  }
  return result
}

function boundedText(value: unknown, label: string, maximum: number): string {
  const result = String(value ?? '').trim()
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error(`${label} must contain 1–${maximum} characters without control characters`)
  }
  return result
}

function outputRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function resultValue(value: unknown): ImpactAnalysisResult {
  const result = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!outputRecord(result)) throw new Error('Stored impact analysis is invalid')
  return result as ImpactAnalysisResult
}

function subjectFromRow(row: ImpactAnalysisRow): DevelopmentSubject {
  const common = {
    repositoryId: row.repositoryId,
    baseRevision: row.baseRevision,
    headRevision: row.headRevision,
  }
  if (row.subjectKind === 'pull_request' && row.pullRequestNumber !== null) {
    return { kind: 'pull_request', ...common, pullRequestNumber: row.pullRequestNumber }
  }
  if (row.subjectKind === 'work_item' && row.workItemId !== null && row.jobId !== null) {
    return { kind: 'work_item', ...common, workItemId: row.workItemId, jobId: row.jobId }
  }
  return { kind: 'repository_comparison', ...common }
}

function digest(result: ImpactAnalysisResult): string {
  return createHash('sha256').update(JSON.stringify(result)).digest('hex')
}

export class ImpactAnalysisService {
  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly run: ImpactCommandRunner,
    private readonly notify: (reason: string, repositoryId: number) => void = () => undefined,
  ) {}

  private repository(repositoryId: number): ImpactAnalyzerRepository {
    const row = this.database
      .select({ id: repositories.id, fullName: repositories.fullName, localPath: repositories.localPath })
      .from(repositories)
      .where(eq(repositories.id, positiveInteger(repositoryId, 'Repository ID')))
      .get()
    if (!row) throw new Error('Repository not found')
    return row
  }

  private async resolveCommit(repository: ImpactAnalyzerRepository, requested: string, signal?: AbortSignal): Promise<string> {
    const candidate = revision(requested, 'Revision')
    const resolveCandidate = (value: string) =>
      this.run('git', ['-C', repository.localPath, 'rev-parse', '--verify', '--end-of-options', `${value}^{commit}`], {
        signal,
        timeoutMs: 10_000,
        maxOutputBytes: 20_000,
      })
    try {
      return revision((await resolveCandidate(candidate)).trim(), 'Resolved revision')
    } catch (error) {
      if (candidate.startsWith('origin/') || /^[a-f0-9]{7,64}$/i.test(candidate)) throw error
      return revision((await resolveCandidate(`origin/${candidate}`)).trim(), 'Resolved revision')
    }
  }

  private async mergeBase(
    repository: ImpactAnalyzerRepository,
    baseRevision: string,
    headRevision: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const value = await this.run('git', ['-C', repository.localPath, 'merge-base', baseRevision, headRevision], {
      signal,
      timeoutMs: 10_000,
      maxOutputBytes: 20_000,
    })
    return revision(value.trim(), 'Merge-base revision')
  }

  async prepareRepositoryComparison(
    repositoryId: number,
    baseRevision: unknown,
    headRevision: unknown,
    signal?: AbortSignal,
  ): Promise<ResolvedImpactAnalysisInput> {
    const repository = this.repository(repositoryId)
    const [base, head] = await Promise.all([
      this.resolveCommit(repository, revision(baseRevision, 'Base revision'), signal),
      this.resolveCommit(repository, revision(headRevision, 'Head revision'), signal),
    ])
    const comparisonBase = await this.mergeBase(repository, base, head, signal)
    return {
      subject: {
        kind: 'repository_comparison',
        repositoryId: repository.id,
        baseRevision: comparisonBase,
        headRevision: head,
      },
    }
  }

  async preparePullRequest(repositoryId: number, pullRequestNumber: number, signal?: AbortSignal): Promise<ResolvedImpactAnalysisInput> {
    const repository = this.repository(repositoryId)
    const number = positiveInteger(pullRequestNumber, 'Pull-request number')
    const pullRequest = this.database
      .select({ baseRef: pullRequests.baseRef, headSha: pullRequests.headSha })
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, repository.id), eq(pullRequests.number, number)))
      .get()
    if (!pullRequest) throw new Error('Pull request not found')
    const baseRef = revision(pullRequest.baseRef, 'Pull-request base revision')
    const headRef = revision(pullRequest.headSha, 'Pull-request head revision')
    const [base, head] = await Promise.all([
      this.resolveCommit(repository, baseRef, signal),
      this.resolveCommit(repository, headRef, signal),
    ])
    return {
      subject: {
        kind: 'pull_request',
        repositoryId: repository.id,
        pullRequestNumber: number,
        baseRevision: await this.mergeBase(repository, base, head, signal),
        headRevision: head,
      },
    }
  }

  async prepareWorkItem(workItemId: number, signal?: AbortSignal): Promise<ResolvedImpactAnalysisInput> {
    const id = positiveInteger(workItemId, 'Work item ID')
    const job = this.database
      .select({
        id: jobs.id,
        repositoryId: jobs.repoId,
        worktreePath: jobs.worktreePath,
        baseRevision: jobs.headSha,
      })
      .from(jobs)
      .where(eq(jobs.workItemId, id))
      .orderBy(desc(jobs.id))
      .limit(1)
      .get()
    if (!job?.baseRevision) throw new Error('Work item has no revision-bound repository job')
    const repository = this.repository(job.repositoryId)
    const [base, head, dirty] = await Promise.all([
      this.resolveCommit(repository, job.baseRevision, signal),
      this.run('git', ['-C', job.worktreePath, 'rev-parse', '--verify', 'HEAD^{commit}'], {
        signal,
        timeoutMs: 10_000,
        maxOutputBytes: 20_000,
      }).then((value) => revision(value.trim(), 'Work head revision')),
      this.run('git', ['-C', job.worktreePath, 'status', '--porcelain'], {
        signal,
        timeoutMs: 10_000,
        maxOutputBytes: 2_000_000,
      }),
    ])
    if (dirty.trim()) throw new Error('Work impact requires committed changes; the worktree currently has uncommitted files')
    return {
      subject: {
        kind: 'work_item',
        repositoryId: repository.id,
        workItemId: id,
        jobId: job.id,
        baseRevision: await this.mergeBase(repository, base, head, signal),
        headRevision: head,
      },
    }
  }

  idempotencyKey(input: ResolvedImpactAnalysisInput): string {
    const subject = input.subject
    return [
      'impact',
      impactAnalyzerVersion,
      subject.kind,
      subject.repositoryId,
      'pullRequestNumber' in subject ? subject.pullRequestNumber : '',
      subject.baseRevision,
      subject.headRevision,
    ].join(':')
  }

  async analyze(input: ResolvedImpactAnalysisInput, signal?: AbortSignal): Promise<ImpactAnalysis> {
    const repository = this.repository(input.subject.repositoryId)
    const result = await analyzeRepositoryImpact({ repository, subject: input.subject, run: this.run, signal })
    const resultDigest = digest(result)
    const values = {
      repositoryId: repository.id,
      subjectKind: input.subject.kind,
      pullRequestNumber: input.subject.kind === 'pull_request' ? input.subject.pullRequestNumber : null,
      workItemId: input.subject.kind === 'work_item' ? input.subject.workItemId : null,
      jobId: input.subject.kind === 'work_item' ? input.subject.jobId : null,
      baseRevision: input.subject.baseRevision,
      headRevision: input.subject.headRevision,
      analyzerVersion: impactAnalyzerVersion,
      status: 'succeeded',
      result,
      digest: resultDigest,
      warningCount: result.warnings.length,
      finishedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    } as const
    this.database
      .insert(impactAnalyses)
      .values(values)
      .onConflictDoUpdate({
        target: [
          impactAnalyses.repositoryId,
          impactAnalyses.subjectKind,
          impactAnalyses.baseRevision,
          impactAnalyses.headRevision,
          impactAnalyses.analyzerVersion,
        ],
        set: {
          result,
          digest: resultDigest,
          warningCount: result.warnings.length,
          status: 'succeeded',
          finishedAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run()
    const row = this.database
      .select()
      .from(impactAnalyses)
      .where(
        and(
          eq(impactAnalyses.repositoryId, repository.id),
          eq(impactAnalyses.subjectKind, input.subject.kind),
          eq(impactAnalyses.baseRevision, input.subject.baseRevision),
          eq(impactAnalyses.headRevision, input.subject.headRevision),
          eq(impactAnalyses.analyzerVersion, impactAnalyzerVersion),
        ),
      )
      .get()
    if (!row) throw new Error('Impact analysis could not be persisted')
    this.notify('impact_analysis_updated', repository.id)
    return this.record(row)
  }

  attachExecution(analysisId: number, executionId: number): ImpactAnalysis {
    this.database
      .update(impactAnalyses)
      .set({ executionId, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(impactAnalyses.id, positiveInteger(analysisId, 'Impact analysis ID')))
      .run()
    const value = this.get(analysisId)
    if (!value) throw new Error('Impact analysis not found')
    return value
  }

  get(analysisId: number): ImpactAnalysis | null {
    const row = this.database
      .select()
      .from(impactAnalyses)
      .where(eq(impactAnalyses.id, positiveInteger(analysisId, 'Impact analysis ID')))
      .get()
    return row ? this.record(row) : null
  }

  list(repositoryId: number, limit = 20): ImpactAnalysisListItem[] {
    const repository = this.repository(repositoryId)
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
    return this.database
      .select()
      .from(impactAnalyses)
      .where(eq(impactAnalyses.repositoryId, repository.id))
      .orderBy(desc(impactAnalyses.id))
      .limit(boundedLimit)
      .all()
      .map((row) => this.listItem(row))
  }

  listForWorkItem(workItemId: number, limit = 50): ImpactAnalysisListItem[] {
    const id = positiveInteger(workItemId, 'Work item ID')
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
    return this.database
      .select()
      .from(impactAnalyses)
      .where(and(eq(impactAnalyses.subjectKind, 'work_item'), eq(impactAnalyses.workItemId, id)))
      .orderBy(desc(impactAnalyses.id))
      .limit(boundedLimit)
      .all()
      .map((row) => this.listItem(row))
  }

  latestForPullRequest(repositoryId: number, pullRequestNumber: number): ImpactAnalysis | null {
    const repository = this.repository(repositoryId)
    const number = positiveInteger(pullRequestNumber, 'Pull-request number')
    const row = this.database
      .select()
      .from(impactAnalyses)
      .where(
        and(
          eq(impactAnalyses.repositoryId, repository.id),
          eq(impactAnalyses.subjectKind, 'pull_request'),
          eq(impactAnalyses.pullRequestNumber, number),
        ),
      )
      .orderBy(desc(impactAnalyses.id))
      .limit(1)
      .get()
    return row ? this.record(row) : null
  }

  latestForRevision(repositoryId: number, headRevision: string): ImpactAnalysis | null {
    const row = this.database
      .select()
      .from(impactAnalyses)
      .where(
        and(
          eq(impactAnalyses.repositoryId, positiveInteger(repositoryId, 'Repository ID')),
          eq(impactAnalyses.headRevision, revision(headRevision, 'Head revision')),
        ),
      )
      .orderBy(desc(impactAnalyses.id))
      .limit(1)
      .get()
    return row ? this.record(row) : null
  }

  latestForWorkItem(workItemId: number): ImpactAnalysis | null {
    const id = positiveInteger(workItemId, 'Work item ID')
    const row = this.database
      .select()
      .from(impactAnalyses)
      .where(and(eq(impactAnalyses.subjectKind, 'work_item'), eq(impactAnalyses.workItemId, id)))
      .orderBy(desc(impactAnalyses.id))
      .limit(1)
      .get()
    return row ? this.record(row) : null
  }

  feedback(analysisId: number): ImpactAnalysisFeedback[] {
    const analysis = this.get(analysisId)
    if (!analysis) throw new Error('Impact analysis not found')
    return this.database
      .select()
      .from(impactAnalysisFeedback)
      .where(eq(impactAnalysisFeedback.analysisId, analysis.id))
      .orderBy(desc(impactAnalysisFeedback.id))
      .all()
      .map((row) => ({ ...row, kind: row.kind as ImpactAnalysisFeedback['kind'] }))
  }

  addFeedback(analysisId: number, input: unknown): ImpactAnalysisFeedback {
    const analysis = this.get(analysisId)
    if (!analysis) throw new Error('Impact analysis not found')
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Impact feedback must be an object')
    const value = input as Record<string, unknown>
    const kind = String(value.kind || '') as ImpactAnalysisFeedback['kind']
    if (!['false_positive', 'missing_relationship'].includes(kind)) throw new Error('Impact feedback kind is invalid')
    const optionalKey = (candidate: unknown): string | null =>
      candidate == null || String(candidate).trim() === '' ? null : boundedText(candidate, 'Impact node key', 500)
    const nodeKey = optionalKey(value.nodeKey)
    const fromNodeKey = optionalKey(value.fromNodeKey)
    const toNodeKey = optionalKey(value.toNodeKey)
    if (kind === 'false_positive' && !nodeKey) throw new Error('False-positive feedback requires a node key')
    const row = this.database
      .insert(impactAnalysisFeedback)
      .values({
        analysisId: analysis.id,
        repositoryId: analysis.subject.repositoryId,
        kind,
        nodeKey,
        fromNodeKey,
        toNodeKey,
        relation: optionalKey(value.relation),
        comment: boundedText(value.comment, 'Feedback comment', 2_000),
        actor: boundedText(value.actor, 'Feedback actor', 200),
      })
      .returning()
      .get()
    this.notify('impact_feedback_recorded', analysis.subject.repositoryId)
    return { ...row, kind: row.kind as ImpactAnalysisFeedback['kind'] }
  }

  private freshness(row: ImpactAnalysisRow): ImpactAnalysis['freshness'] {
    if (row.subjectKind !== 'pull_request' || row.pullRequestNumber === null) return 'unknown'
    const current = this.database
      .select({ headSha: pullRequests.headSha })
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, row.repositoryId), eq(pullRequests.number, row.pullRequestNumber)))
      .get()
    if (!current?.headSha) return 'unknown'
    return current.headSha === row.headRevision ? 'current' : 'stale'
  }

  private listItem(row: ImpactAnalysisRow): ImpactAnalysisListItem {
    const analysis = this.record(row)
    return {
      id: analysis.id,
      executionId: analysis.executionId,
      subject: analysis.subject,
      status: analysis.status,
      freshness: analysis.freshness,
      progress: analysis.progress,
      resultVersion: analysis.resultVersion,
      digest: analysis.digest,
      warningCount: analysis.warningCount,
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
      finishedAt: analysis.finishedAt,
      repositoryName: analysis.result.repositoryName,
      changedFileCount: analysis.result.changedFiles.length,
      affectedProjectCount: analysis.result.summary.directProjects + analysis.result.summary.transitiveProjects,
      risk: analysis.result.summary.risk,
    }
  }

  private record(row: ImpactAnalysisRow): ImpactAnalysis {
    return {
      id: row.id,
      executionId: row.executionId,
      subject: subjectFromRow(row),
      status: row.status as ImpactAnalysis['status'],
      freshness: this.freshness(row),
      progress: row.status === 'succeeded' ? 1 : 0,
      resultVersion: row.analyzerVersion,
      digest: row.digest,
      warningCount: row.warningCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      finishedAt: row.finishedAt,
      result: resultValue(row.result),
    }
  }
}

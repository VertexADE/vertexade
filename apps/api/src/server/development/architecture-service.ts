import { createHash } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import type {
  ArchitectureContextFact,
  ArchitectureContextPacket,
  ArchitectureIndex,
  ArchitectureIndexResult,
  ArchitectureNode,
  ArchitectureSourceCitation,
  DevelopmentSubject,
  ImpactAnalysisResult,
} from '@vertexade/platform-contracts'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { architectureContextPackets, architectureIndexes, impactAnalyses } from '../database/schema/development-tables.ts'
import { pullRequests, repositories } from '../database/schema/tables.ts'
import { analyzeRepositoryArchitecture, architectureIndexVersion, type ArchitectureAnalyzerRepository } from './architecture-analyzer.ts'
import type { ImpactCommandRunner } from './impact-analyzer.ts'

export type ResolvedArchitectureIndexInput = {
  repositoryId: number
  revision: string
}

type ArchitectureIndexRow = typeof architectureIndexes.$inferSelect
type ArchitectureContextPacketRow = typeof architectureContextPackets.$inferSelect

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

function objectValue(value: unknown): Record<string, unknown> | null {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}

function architectureResult(value: unknown): ArchitectureIndexResult {
  const result = objectValue(value)
  if (!result) throw new Error('Stored architecture index is invalid')
  return result as ArchitectureIndexResult
}

function impactResult(value: unknown): ImpactAnalysisResult | null {
  const result = objectValue(value)
  return result ? (result as ImpactAnalysisResult) : null
}

function contentDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function subjectKey(subject: DevelopmentSubject): string {
  if (subject.kind === 'pull_request') return `${subject.repositoryId}#${subject.pullRequestNumber}@${subject.headRevision}`
  if (subject.kind === 'work_item') return `${subject.workItemId}:${subject.jobId}@${subject.headRevision}`
  if (subject.kind === 'migration_target') return `${subject.campaignId}:${subject.targetId}@${subject.headRevision}`
  return `${subject.repositoryId}:${subject.baseRevision}..${subject.headRevision}`
}

function citationKey(citation: ArchitectureSourceCitation): string {
  return `${citation.path}:${citation.startLine || ''}:${citation.endLine || ''}:${citation.digest}`
}

function normalizedFocusPaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  return [
    ...new Set(
      paths
        .map((path) =>
          String(path || '')
            .trim()
            .replaceAll('\\', '/'),
        )
        .filter((path) => path && path.length <= 1_000),
    ),
  ]
    .sort()
    .slice(0, 1_000)
}

export class ArchitectureContextService {
  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly run: ImpactCommandRunner,
    private readonly notify: (reason: string, repositoryId: number) => void = () => undefined,
  ) {}

  private repository(repositoryId: number): ArchitectureAnalyzerRepository {
    const row = this.database
      .select({ id: repositories.id, fullName: repositories.fullName, localPath: repositories.localPath })
      .from(repositories)
      .where(eq(repositories.id, positiveInteger(repositoryId, 'Repository ID')))
      .get()
    if (!row) throw new Error('Repository not found')
    return row
  }

  private async resolveCommit(repository: ArchitectureAnalyzerRepository, rawRevision: unknown, signal?: AbortSignal): Promise<string> {
    const requested = revision(rawRevision, 'Revision')
    const resolveCandidate = (candidate: string) =>
      this.run('git', ['-C', repository.localPath, 'rev-parse', '--verify', '--end-of-options', `${candidate}^{commit}`], {
        signal,
        timeoutMs: 10_000,
        maxOutputBytes: 20_000,
      })
    try {
      return revision((await resolveCandidate(requested)).trim(), 'Resolved revision')
    } catch (error) {
      if (requested.startsWith('origin/') || /^[a-f0-9]{7,64}$/i.test(requested)) throw error
      return revision((await resolveCandidate(`origin/${requested}`)).trim(), 'Resolved revision')
    }
  }

  async prepareIndex(repositoryId: number, rawRevision: unknown, signal?: AbortSignal): Promise<ResolvedArchitectureIndexInput> {
    const repository = this.repository(repositoryId)
    return { repositoryId: repository.id, revision: await this.resolveCommit(repository, rawRevision, signal) }
  }

  async preparePullRequestSubject(repositoryId: number, pullRequestNumber: number, signal?: AbortSignal): Promise<DevelopmentSubject> {
    const repository = this.repository(repositoryId)
    const number = positiveInteger(pullRequestNumber, 'Pull-request number')
    const pullRequest = this.database
      .select({ baseRef: pullRequests.baseRef, headSha: pullRequests.headSha })
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, repository.id), eq(pullRequests.number, number)))
      .get()
    if (!pullRequest) throw new Error('Pull request not found')
    const [base, head] = await Promise.all([
      this.resolveCommit(repository, pullRequest.baseRef, signal),
      this.resolveCommit(repository, pullRequest.headSha, signal),
    ])
    const mergeBase = revision(
      (
        await this.run('git', ['-C', repository.localPath, 'merge-base', base, head], {
          signal,
          timeoutMs: 10_000,
          maxOutputBytes: 20_000,
        })
      ).trim(),
      'Merge-base revision',
    )
    return { kind: 'pull_request', repositoryId: repository.id, pullRequestNumber: number, baseRevision: mergeBase, headRevision: head }
  }

  idempotencyKey(input: ResolvedArchitectureIndexInput): string {
    return `architecture:${architectureIndexVersion}:${input.repositoryId}:${input.revision}`
  }

  async index(input: ResolvedArchitectureIndexInput, signal?: AbortSignal): Promise<ArchitectureIndex> {
    const repository = this.repository(input.repositoryId)
    const result = await analyzeRepositoryArchitecture({ repository, revision: input.revision, run: this.run, signal })
    const digest = contentDigest(result)
    this.database
      .insert(architectureIndexes)
      .values({
        repositoryId: repository.id,
        revision: input.revision,
        indexVersion: architectureIndexVersion,
        status: 'succeeded',
        result,
        digest,
        warningCount: result.warnings.length,
        finishedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: [architectureIndexes.repositoryId, architectureIndexes.revision, architectureIndexes.indexVersion],
        set: {
          status: 'succeeded',
          result,
          digest,
          warningCount: result.warnings.length,
          updatedAt: sql`CURRENT_TIMESTAMP`,
          finishedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run()
    const row = this.database
      .select()
      .from(architectureIndexes)
      .where(
        and(
          eq(architectureIndexes.repositoryId, repository.id),
          eq(architectureIndexes.revision, input.revision),
          eq(architectureIndexes.indexVersion, architectureIndexVersion),
        ),
      )
      .get()
    if (!row) throw new Error('Architecture index could not be persisted')
    this.notify('architecture_index_updated', repository.id)
    return this.indexRecord(row)
  }

  attachExecution(indexId: number, executionId: number): ArchitectureIndex {
    this.database
      .update(architectureIndexes)
      .set({ executionId, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(architectureIndexes.id, positiveInteger(indexId, 'Architecture index ID')))
      .run()
    const value = this.getIndex(indexId)
    if (!value) throw new Error('Architecture index not found')
    return value
  }

  getIndex(indexId: number): ArchitectureIndex | null {
    const row = this.database
      .select()
      .from(architectureIndexes)
      .where(eq(architectureIndexes.id, positiveInteger(indexId, 'Architecture index ID')))
      .get()
    return row ? this.indexRecord(row) : null
  }

  indexForRevision(repositoryId: number, rawRevision: string): ArchitectureIndex | null {
    const repository = this.repository(repositoryId)
    const row = this.database
      .select()
      .from(architectureIndexes)
      .where(
        and(
          eq(architectureIndexes.repositoryId, repository.id),
          eq(architectureIndexes.revision, revision(rawRevision, 'Revision')),
          eq(architectureIndexes.indexVersion, architectureIndexVersion),
        ),
      )
      .orderBy(desc(architectureIndexes.id))
      .limit(1)
      .get()
    return row ? this.indexRecord(row) : null
  }

  latestIndex(repositoryId: number): ArchitectureIndex | null {
    const repository = this.repository(repositoryId)
    const row = this.database
      .select()
      .from(architectureIndexes)
      .where(eq(architectureIndexes.repositoryId, repository.id))
      .orderBy(desc(architectureIndexes.id))
      .limit(1)
      .get()
    return row ? this.indexRecord(row) : null
  }

  async latestIndexWithFreshness(repositoryId: number, signal?: AbortSignal): Promise<ArchitectureIndex | null> {
    const index = this.latestIndex(repositoryId)
    if (!index) return null
    const current = await this.prepareIndex(repositoryId, 'HEAD', signal)
    return { ...index, freshness: current.revision === index.result.revision ? 'current' : 'stale' }
  }

  focusPathsForSubject(subject: DevelopmentSubject, explicitPaths: unknown = []): string[] {
    const explicit = normalizedFocusPaths(explicitPaths)
    if (explicit.length || subject.kind !== 'pull_request') return explicit
    const row = this.database
      .select({ result: impactAnalyses.result })
      .from(impactAnalyses)
      .where(
        and(
          eq(impactAnalyses.repositoryId, subject.repositoryId),
          eq(impactAnalyses.subjectKind, 'pull_request'),
          eq(impactAnalyses.pullRequestNumber, subject.pullRequestNumber),
          eq(impactAnalyses.headRevision, subject.headRevision),
        ),
      )
      .orderBy(desc(impactAnalyses.id))
      .limit(1)
      .get()
    const impact = row ? impactResult(row.result) : null
    return normalizedFocusPaths([
      ...(impact?.changedFiles.map((file) => file.path) || []),
      ...(impact?.nodes.map((node) => node.path).filter((path): path is string => Boolean(path)) || []),
    ])
  }

  createContextPacket({
    indexId,
    subject,
    focusPaths = [],
    byteBudget = 32_000,
  }: {
    indexId: number
    subject: DevelopmentSubject
    focusPaths?: string[]
    byteBudget?: number
  }): ArchitectureContextPacket {
    const index = this.getIndex(indexId)
    if (!index || index.subject.repositoryId !== subject.repositoryId)
      throw new Error('Architecture index not found for subject repository')
    if (index.subject.headRevision !== subject.headRevision)
      throw new Error('Architecture index revision does not match the context subject')
    const budget = Math.min(Math.max(Math.trunc(byteBudget), 4_000), 128_000)
    const paths = normalizedFocusPaths(focusPaths)
    const selected = new Map<string, ArchitectureContextFact>()
    const matchesPath = (node: ArchitectureNode) =>
      node.path !== null && paths.some((path) => path === node.path || path.startsWith(`${node.path}/`) || node.path.startsWith(`${path}/`))
    for (const node of index.result.nodes) {
      if (node.kind === 'repository' || matchesPath(node)) {
        selected.set(node.key, {
          node,
          reason: node.kind === 'repository' ? 'Repository boundary' : 'Matches an impacted path',
          distance: node.kind === 'repository' ? 1 : 0,
        })
      }
    }
    if (selected.size === 1) {
      for (const node of index.result.nodes
        .filter((candidate) => ['service', 'package', 'document'].includes(candidate.kind))
        .slice(0, 20)) {
        selected.set(node.key, { node, reason: 'Repository architecture overview', distance: 1 })
      }
    }
    for (let distance = 1; distance <= 2; distance += 1) {
      for (const relation of index.result.relations) {
        const fromSelected = selected.get(relation.from)
        const toSelected = selected.get(relation.to)
        if (fromSelected && fromSelected.distance < distance && !toSelected) {
          const node = index.result.nodes.find((candidate) => candidate.key === relation.to)
          if (node) selected.set(node.key, { node, reason: relation.summary, distance })
        }
        if (toSelected && toSelected.distance < distance && !fromSelected) {
          const node = index.result.nodes.find((candidate) => candidate.key === relation.from)
          if (node) selected.set(node.key, { node, reason: relation.summary, distance })
        }
      }
    }
    const orderedFacts = [...selected.values()].sort(
      (left, right) =>
        left.distance - right.distance || left.node.kind.localeCompare(right.node.kind) || left.node.key.localeCompare(right.node.key),
    )
    const facts: ArchitectureContextFact[] = []
    let estimatedBytes = 0
    for (const fact of orderedFacts) {
      const bytes = Buffer.byteLength(JSON.stringify(fact))
      if (estimatedBytes + bytes > budget) break
      facts.push(fact)
      estimatedBytes += bytes
    }
    const factKeys = new Set(facts.map((fact) => fact.node.key))
    const relations = index.result.relations.filter((relation) => factKeys.has(relation.from) && factKeys.has(relation.to))
    const decisions = index.result.decisions.filter((decision) =>
      facts.some((fact) => fact.node.citations.some((item) => item.path === decision.citation.path)),
    )
    const citations = [
      ...new Map(
        [
          ...facts.flatMap((fact) => fact.node.citations),
          ...relations.map((relation) => relation.citation),
          ...decisions.map((decision) => decision.citation),
        ].map((citation) => [citationKey(citation), citation]),
      ).values(),
    ]
    const warnings = [...index.result.warnings]
    const truncated = facts.length < orderedFacts.length
    if (truncated)
      warnings.push({ code: 'architecture_context_truncated', message: `Context exceeded its ${budget}-byte budget`, path: null })
    const packetContent = {
      subject,
      revision: subject.headRevision,
      facts,
      relations,
      decisions,
      citations,
      warnings,
      byteBudget: budget,
      truncated,
    }
    const digest = contentDigest(packetContent)
    this.database
      .insert(architectureContextPackets)
      .values({
        repositoryId: subject.repositoryId,
        indexId: index.id,
        subjectKind: subject.kind,
        subjectKey: subjectKey(subject),
        revision: subject.headRevision,
        subject,
        packet: packetContent,
        digest,
        byteBudget: budget,
        estimatedBytes,
        truncated: truncated ? 1 : 0,
      })
      .onConflictDoNothing()
      .run()
    const row = this.database
      .select()
      .from(architectureContextPackets)
      .where(
        and(
          eq(architectureContextPackets.indexId, index.id),
          eq(architectureContextPackets.subjectKind, subject.kind),
          eq(architectureContextPackets.subjectKey, subjectKey(subject)),
          eq(architectureContextPackets.byteBudget, budget),
          eq(architectureContextPackets.digest, digest),
        ),
      )
      .get()
    if (!row) throw new Error('Architecture context packet could not be persisted')
    this.notify('architecture_context_updated', subject.repositoryId)
    return this.packetRecord(row)
  }

  latestContextPacket(subject: DevelopmentSubject): ArchitectureContextPacket | null {
    const row = this.database
      .select()
      .from(architectureContextPackets)
      .where(
        and(
          eq(architectureContextPackets.repositoryId, subject.repositoryId),
          eq(architectureContextPackets.subjectKind, subject.kind),
          eq(architectureContextPackets.subjectKey, subjectKey(subject)),
        ),
      )
      .orderBy(desc(architectureContextPackets.id))
      .limit(1)
      .get()
    return row ? this.packetRecord(row) : null
  }

  private indexRecord(row: ArchitectureIndexRow): ArchitectureIndex {
    const subject: DevelopmentSubject = {
      kind: 'repository_comparison',
      repositoryId: row.repositoryId,
      baseRevision: row.revision,
      headRevision: row.revision,
    }
    return {
      id: row.id,
      executionId: row.executionId,
      subject,
      status: row.status as ArchitectureIndex['status'],
      freshness: 'unknown',
      progress: row.status === 'succeeded' ? 1 : 0,
      resultVersion: row.indexVersion,
      digest: row.digest,
      warningCount: row.warningCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      finishedAt: row.finishedAt,
      result: architectureResult(row.result),
    }
  }

  private packetFreshness(row: ArchitectureContextPacketRow): ArchitectureContextPacket['freshness'] {
    if (row.subjectKind !== 'pull_request') return 'unknown'
    const subject = objectValue(row.subject) as DevelopmentSubject | null
    if (!subject || subject.kind !== 'pull_request') return 'unknown'
    const current = this.database
      .select({ headSha: pullRequests.headSha })
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, row.repositoryId), eq(pullRequests.number, subject.pullRequestNumber)))
      .get()
    if (!current?.headSha) return 'unknown'
    return current.headSha === row.revision ? 'current' : 'stale'
  }

  private packetRecord(row: ArchitectureContextPacketRow): ArchitectureContextPacket {
    const content = objectValue(row.packet)
    const subject = objectValue(row.subject) as DevelopmentSubject | null
    if (!content || !subject) throw new Error('Stored architecture context packet is invalid')
    return {
      id: row.id,
      indexId: row.indexId,
      subject,
      revision: row.revision,
      facts: (content.facts || []) as ArchitectureContextPacket['facts'],
      relations: (content.relations || []) as ArchitectureContextPacket['relations'],
      decisions: (content.decisions || []) as ArchitectureContextPacket['decisions'],
      citations: (content.citations || []) as ArchitectureContextPacket['citations'],
      warnings: (content.warnings || []) as ArchitectureContextPacket['warnings'],
      byteBudget: row.byteBudget,
      estimatedBytes: row.estimatedBytes,
      truncated: Boolean(row.truncated),
      digest: row.digest,
      freshness: this.packetFreshness(row),
      createdAt: row.createdAt,
    }
  }
}

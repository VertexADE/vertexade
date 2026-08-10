import { createHash } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type {
  DevelopmentSubject,
  PullRequestEvidenceEntry,
  PullRequestEvidenceSnapshot,
  PullRequestEvidenceStatus,
  PullRequestEvidenceWaiver,
  PullRequestReadiness,
  PullRequestReadinessPolicy,
  PullRequestReadinessRule,
  ReadinessRuleCondition,
} from '@vertexade/platform-contracts'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import {
  pullRequestEvidencePolicies,
  pullRequestEvidenceSnapshots,
  pullRequestEvidenceWaivers,
} from '../database/schema/development-tables.ts'
import { pullRequests, repositories } from '../database/schema/tables.ts'
import type { ArchitectureContextService } from './architecture-service.ts'
import type { ImpactAnalysisService } from './impact-service.ts'
import type { ValidationIntelligenceService } from './validation-service.ts'

const defaultRules: PullRequestReadinessRule[] = [
  { entryKey: 'scope.impact', required: true, condition: 'always' },
  { entryKey: 'architecture.context', required: true, condition: 'contract_change' },
  { entryKey: 'architecture.context', required: true, condition: 'database_change' },
  { entryKey: 'architecture.context', required: true, condition: 'delivery_change' },
  { entryKey: 'validation.targets', required: true, condition: 'always' },
  { entryKey: 'review.checks', required: true, condition: 'always' },
  { entryKey: 'review.approval', required: true, condition: 'always' },
  { entryKey: 'release.delivery', required: true, condition: 'delivery_change' },
  { entryKey: 'release.contract', required: true, condition: 'contract_change' },
  { entryKey: 'release.contract', required: true, condition: 'database_change' },
]

type PullRequestRecord = {
  repositoryId: number
  repositoryName: string
  pullRequestNumber: number
  url: string
  headRevision: string
  baseRevision: string
  checksPending: number
  checksFailed: number
  reviewDecision: string | null
  mergeStateStatus: string | null
  updatedAt: string | null
}

function positiveInteger(value: unknown, label: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${label} must be a positive integer`)
  return result
}

function textValue(value: unknown, label: string, maximum: number): string {
  const result = String(value ?? '').trim()
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error(`${label} must contain 1–${maximum} characters without control characters`)
  }
  return result
}

function arrayValue<T>(value: unknown): T[] {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  return Array.isArray(parsed) ? (parsed as T[]) : []
}

function recordValue<T extends object>(value: unknown): T {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Stored evidence value is invalid')
  return parsed as T
}

function counts(entries: PullRequestEvidenceEntry[]): Record<PullRequestEvidenceStatus, number> {
  const result: Record<PullRequestEvidenceStatus, number> = {
    passed: 0,
    failed: 0,
    blocked: 0,
    not_applicable: 0,
    unknown: 0,
    stale: 0,
  }
  for (const entry of entries) result[entry.status] += 1
  return result
}

function readiness(entries: PullRequestEvidenceEntry[]): PullRequestReadiness {
  const required = entries.filter((entry) => entry.required && !entry.waiver)
  if (required.some((entry) => entry.status === 'failed' || entry.status === 'blocked')) return 'blocked'
  if (required.some((entry) => entry.status === 'stale')) return 'stale'
  if (required.some((entry) => entry.status === 'unknown')) return 'unknown'
  return 'ready'
}

function activeCondition(
  condition: ReadinessRuleCondition,
  impact: { contractChanges: number; databaseChanges: boolean; deliveryEffects: number },
): boolean {
  if (condition === 'always') return true
  if (condition === 'contract_change') return impact.contractChanges > 0
  if (condition === 'database_change') return impact.databaseChanges
  return impact.deliveryEffects > 0
}

function digestEntries(headRevision: string, policyVersion: number, entries: PullRequestEvidenceEntry[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        headRevision,
        policyVersion,
        entries: entries.map(({ capturedAt: _capturedAt, ...entry }) => entry),
      }),
    )
    .digest('hex')
}

export class PullRequestEvidenceService {
  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly impact: ImpactAnalysisService,
    private readonly architecture: ArchitectureContextService,
    private readonly validation: ValidationIntelligenceService,
    private readonly notify: (reason: string, repositoryId: number) => void = () => undefined,
  ) {}

  private pullRequest(repositoryId: number, pullRequestNumber: number): PullRequestRecord {
    const row = this.database
      .select({ pullRequest: pullRequests, repositoryName: repositories.fullName })
      .from(pullRequests)
      .innerJoin(repositories, eq(repositories.id, pullRequests.repoId))
      .where(
        and(
          eq(pullRequests.repoId, positiveInteger(repositoryId, 'Repository ID')),
          eq(pullRequests.number, positiveInteger(pullRequestNumber, 'Pull-request number')),
        ),
      )
      .get()
    if (!row?.pullRequest.headSha) throw new Error('Pull request or captured head revision not found')
    return {
      repositoryId: row.pullRequest.repoId,
      repositoryName: row.repositoryName,
      pullRequestNumber: row.pullRequest.number,
      url: row.pullRequest.url,
      headRevision: row.pullRequest.headSha,
      baseRevision: row.pullRequest.baseRef || row.pullRequest.headSha,
      checksPending: row.pullRequest.checksPending,
      checksFailed: row.pullRequest.checksFailed,
      reviewDecision: row.pullRequest.reviewDecision,
      mergeStateStatus: row.pullRequest.mergeStateStatus,
      updatedAt: row.pullRequest.updatedAt,
    }
  }

  policy(repositoryId: number): PullRequestReadinessPolicy {
    const id = positiveInteger(repositoryId, 'Repository ID')
    const repository = this.database.select({ id: repositories.id }).from(repositories).where(eq(repositories.id, id)).get()
    if (!repository) throw new Error('Repository not found')
    const stored = this.database.select().from(pullRequestEvidencePolicies).where(eq(pullRequestEvidencePolicies.repositoryId, id)).get()
    return stored
      ? { repositoryId: id, version: stored.version, rules: arrayValue(stored.rules), updatedAt: stored.updatedAt }
      : { repositoryId: null, version: 1, rules: defaultRules, updatedAt: new Date(0).toISOString() }
  }

  updatePolicy(repositoryId: number, input: unknown): PullRequestReadinessPolicy {
    const id = positiveInteger(repositoryId, 'Repository ID')
    const value = input as { rules?: unknown }
    if (!value || typeof value !== 'object' || !Array.isArray(value.rules) || value.rules.length > 100) {
      throw new Error('Readiness policy rules must be an array of at most 100 entries')
    }
    const conditions: ReadinessRuleCondition[] = ['always', 'contract_change', 'database_change', 'delivery_change']
    const rules = value.rules.map<PullRequestReadinessRule>((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Readiness policy rule must be an object')
      const rule = raw as Record<string, unknown>
      const condition = String(rule.condition || '') as ReadinessRuleCondition
      if (!conditions.includes(condition)) throw new Error('Readiness policy condition is invalid')
      return {
        entryKey: textValue(rule.entryKey, 'Evidence entry key', 300),
        required: rule.required !== false,
        condition,
      }
    })
    const current = this.policy(id)
    this.database
      .insert(pullRequestEvidencePolicies)
      .values({ repositoryId: id, version: current.repositoryId === null ? 1 : current.version + 1, rules })
      .onConflictDoUpdate({
        target: pullRequestEvidencePolicies.repositoryId,
        set: { version: current.version + 1, rules, updatedAt: sql`CURRENT_TIMESTAMP` },
      })
      .run()
    this.notify('pull_request_evidence_policy_updated', id)
    return this.policy(id)
  }

  activeWaivers(repositoryId: number, pullRequestNumber: number, headRevision: string): PullRequestEvidenceWaiver[] {
    const now = new Date().toISOString()
    return this.database
      .select()
      .from(pullRequestEvidenceWaivers)
      .where(
        and(
          eq(pullRequestEvidenceWaivers.repositoryId, repositoryId),
          eq(pullRequestEvidenceWaivers.pullRequestNumber, pullRequestNumber),
          eq(pullRequestEvidenceWaivers.headRevision, headRevision),
          isNull(pullRequestEvidenceWaivers.revokedAt),
        ),
      )
      .all()
      .filter((row) => !row.expiresAt || row.expiresAt > now)
      .map((row) => ({ ...row, revokedAt: row.revokedAt }))
  }

  async addWaiver(
    repositoryId: number,
    pullRequestNumber: number,
    input: { entryKey?: unknown; actor?: unknown; reason?: unknown; expiresAt?: unknown },
  ): Promise<PullRequestEvidenceSnapshot> {
    const pullRequest = this.pullRequest(repositoryId, pullRequestNumber)
    const expiresAt = input.expiresAt ? new Date(String(input.expiresAt)).toISOString() : null
    if (expiresAt && expiresAt <= new Date().toISOString()) throw new Error('Waiver expiry must be in the future')
    this.database
      .insert(pullRequestEvidenceWaivers)
      .values({
        repositoryId: pullRequest.repositoryId,
        pullRequestNumber: pullRequest.pullRequestNumber,
        headRevision: pullRequest.headRevision,
        entryKey: textValue(input.entryKey, 'Evidence entry key', 300),
        actor: textValue(input.actor, 'Waiver actor', 200),
        reason: textValue(input.reason, 'Waiver reason', 2_000),
        expiresAt,
      })
      .run()
    this.notify('pull_request_evidence_waived', repositoryId)
    return this.collect(repositoryId, pullRequestNumber)
  }

  async collect(repositoryId: number, pullRequestNumber: number): Promise<PullRequestEvidenceSnapshot> {
    const pullRequest = this.pullRequest(repositoryId, pullRequestNumber)
    const policy = this.policy(repositoryId)
    const impact = this.impact.latestForPullRequest(repositoryId, pullRequestNumber)
    const subject: DevelopmentSubject = {
      kind: 'pull_request',
      repositoryId,
      pullRequestNumber,
      baseRevision: impact?.subject.baseRevision || pullRequest.baseRevision,
      headRevision: pullRequest.headRevision,
    }
    const architecture = this.architecture.latestContextPacket(subject)
    let intelligence: Awaited<ReturnType<ValidationIntelligenceService['pullRequestIntelligence']>> | null = null
    let validationError: string | null = null
    try {
      intelligence = await this.validation.pullRequestIntelligence(repositoryId, pullRequestNumber)
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error || 'Validation catalog unavailable')
    }
    const impactConditions = {
      contractChanges: impact?.result.summary.contractChanges || 0,
      databaseChanges: Boolean(impact?.result.nodes.some((node) => node.kind === 'database')),
      deliveryEffects: impact?.result.summary.deliveryEffects || 0,
    }
    const requiredKeys = new Set(
      policy.rules.filter((rule) => rule.required && activeCondition(rule.condition, impactConditions)).map((rule) => rule.entryKey),
    )
    const capturedAt = new Date().toISOString()
    const waivers = new Map(
      this.activeWaivers(repositoryId, pullRequestNumber, pullRequest.headRevision).map((waiver) => [waiver.entryKey, waiver]),
    )
    const entry = (value: Omit<PullRequestEvidenceEntry, 'required' | 'capturedAt' | 'waiver'>): PullRequestEvidenceEntry => ({
      ...value,
      required: requiredKeys.has(value.key),
      capturedAt,
      waiver: waivers.get(value.key) || null,
    })
    const entries: PullRequestEvidenceEntry[] = []
    entries.push(
      entry({
        key: 'scope.impact',
        category: 'scope',
        decision: 'scope_understood',
        label: 'Change impact is understood',
        status: !impact ? 'unknown' : impact.freshness === 'stale' ? 'stale' : 'passed',
        provider: 'core.impact',
        proof: !impact
          ? 'No impact analysis has been collected for this pull request.'
          : `${impact.result.changedFiles.length} changed files, ${impact.result.summary.directProjects + impact.result.summary.transitiveProjects} affected projects, ${impact.warningCount} warnings.`,
        sourceUrl: null,
        entityReference: impact ? `impact_analysis:${impact.id}` : null,
        observedHeadRevision: impact?.subject.headRevision || null,
        executionId: impact?.executionId || null,
        action: 'refresh_impact',
      }),
    )
    entries.push(
      entry({
        key: 'architecture.context',
        category: 'architecture',
        decision: 'scope_understood',
        label: 'Architecture context is available',
        status: !architecture
          ? 'unknown'
          : architecture.freshness === 'stale'
            ? 'stale'
            : architecture.warnings.length
              ? 'unknown'
              : 'passed',
        provider: 'core.architecture',
        proof: !architecture
          ? 'No architecture packet has been built for the current head.'
          : `${architecture.facts.length} facts and ${architecture.citations.length} source citations; ${architecture.warnings.length} warnings.`,
        sourceUrl: null,
        entityReference: architecture ? `architecture_context:${architecture.id}` : null,
        observedHeadRevision: architecture?.revision || null,
        executionId: null,
        action: 'build_architecture',
      }),
    )
    const selected = intelligence?.selection?.selected || []
    const latestRuns = new Map<number | string, (typeof intelligence.runs)[number]>()
    for (const run of intelligence?.runs || []) if (!latestRuns.has(run.target.id)) latestRuns.set(run.target.id, run)
    const selectedRuns = selected.map((target) => latestRuns.get(target.id)).filter((run) => run !== undefined)
    const missingRuns = selected.length - selectedRuns.length
    const validationStatus: PullRequestEvidenceStatus = validationError
      ? 'unknown'
      : intelligence?.analysis?.freshness === 'stale' || selectedRuns.some((run) => run.freshness === 'stale')
        ? 'stale'
        : selectedRuns.some((run) => run.status === 'failed' || run.status === 'timed-out')
          ? 'failed'
          : selectedRuns.some((run) => run.status === 'running')
            ? 'blocked'
            : intelligence?.selection?.coverageGaps.length || missingRuns
              ? 'unknown'
              : selected.length === 0
                ? 'not_applicable'
                : selectedRuns.every((run) => run.status === 'passed')
                  ? 'passed'
                  : 'unknown'
    entries.push(
      entry({
        key: 'validation.targets',
        category: 'validation',
        decision: 'behavior_validated',
        label: 'Required validation targets pass',
        status: validationStatus,
        provider: 'core.validation',
        proof:
          validationError ||
          `${selectedRuns.filter((run) => run.status === 'passed').length}/${selected.length} selected targets pass; ${missingRuns} missing; ${intelligence?.selection?.coverageGaps.length || 0} coverage gaps.`,
        sourceUrl: null,
        entityReference: impact ? `impact_analysis:${impact.id}:validation` : null,
        observedHeadRevision: intelligence?.selection?.revision || null,
        executionId: selectedRuns[0]?.executionId || null,
        action: 'run_validation',
      }),
    )
    entries.push(
      entry({
        key: 'review.checks',
        category: 'review',
        decision: 'behavior_validated',
        label: 'Source-control checks pass',
        status: !pullRequest.updatedAt ? 'unknown' : pullRequest.checksFailed ? 'failed' : pullRequest.checksPending ? 'blocked' : 'passed',
        provider: 'source-control',
        proof: pullRequest.updatedAt
          ? `${pullRequest.checksFailed} failed and ${pullRequest.checksPending} pending provider checks.`
          : 'The source-control check collector has not recorded an observation.',
        sourceUrl: pullRequest.url,
        entityReference: `${pullRequest.repositoryName}#${pullRequest.pullRequestNumber}`,
        observedHeadRevision: pullRequest.headRevision,
        executionId: null,
        action: 'collect_provider',
      }),
    )
    const reviewDecision = String(pullRequest.reviewDecision || '').toUpperCase()
    entries.push(
      entry({
        key: 'review.approval',
        category: 'review',
        decision: 'review_resolved',
        label: 'Required review is approved',
        status: reviewDecision === 'APPROVED' ? 'passed' : reviewDecision === 'CHANGES_REQUESTED' ? 'failed' : 'unknown',
        provider: 'source-control',
        proof: reviewDecision
          ? `Provider review decision: ${reviewDecision.toLowerCase().replaceAll('_', ' ')}.`
          : 'No approval decision is available.',
        sourceUrl: pullRequest.url,
        entityReference: `${pullRequest.repositoryName}#${pullRequest.pullRequestNumber}:reviews`,
        observedHeadRevision: pullRequest.headRevision,
        executionId: null,
        action: 'request_review',
      }),
    )
    entries.push(
      entry({
        key: 'release.contract',
        category: 'release',
        decision: 'release_safe',
        label: 'Contract and database compatibility is proven',
        status: impactConditions.contractChanges || impactConditions.databaseChanges ? 'unknown' : 'not_applicable',
        provider: 'core.impact',
        proof:
          impactConditions.contractChanges || impactConditions.databaseChanges
            ? 'Compatibility evidence is required because public contracts or database surfaces changed.'
            : 'No public-contract or database change was detected.',
        sourceUrl: null,
        entityReference: impact ? `impact_analysis:${impact.id}:contracts` : null,
        observedHeadRevision: impact?.subject.headRevision || null,
        executionId: impact?.executionId || null,
        action: 'collect_provider',
      }),
    )
    entries.push(
      entry({
        key: 'release.delivery',
        category: 'release',
        decision: 'release_safe',
        label: 'Delivery and preview evidence is available',
        status: impactConditions.deliveryEffects ? 'unknown' : 'not_applicable',
        provider: 'core.delivery',
        proof: impactConditions.deliveryEffects
          ? `${impactConditions.deliveryEffects} delivery effects require deployment or preview evidence.`
          : 'No delivery effect was detected.',
        sourceUrl: null,
        entityReference: impact ? `impact_analysis:${impact.id}:delivery` : null,
        observedHeadRevision: impact?.subject.headRevision || null,
        executionId: null,
        action: 'collect_provider',
      }),
    )
    const digest = digestEntries(pullRequest.headRevision, policy.version, entries)
    this.database
      .insert(pullRequestEvidenceSnapshots)
      .values({
        repositoryId,
        pullRequestNumber,
        headRevision: pullRequest.headRevision,
        policyVersion: policy.version,
        readiness: readiness(entries),
        entries,
        counts: counts(entries),
        digest,
      })
      .onConflictDoNothing()
      .run()
    this.notify('pull_request_evidence_collected', repositoryId)
    return this.snapshot(
      this.database
        .select()
        .from(pullRequestEvidenceSnapshots)
        .where(
          and(
            eq(pullRequestEvidenceSnapshots.repositoryId, repositoryId),
            eq(pullRequestEvidenceSnapshots.pullRequestNumber, pullRequestNumber),
            eq(pullRequestEvidenceSnapshots.headRevision, pullRequest.headRevision),
            eq(pullRequestEvidenceSnapshots.policyVersion, policy.version),
            eq(pullRequestEvidenceSnapshots.digest, digest),
          ),
        )
        .get()!,
      pullRequest.headRevision,
    )
  }

  latest(repositoryId: number, pullRequestNumber: number): PullRequestEvidenceSnapshot | null {
    const pullRequest = this.pullRequest(repositoryId, pullRequestNumber)
    const row = this.database
      .select()
      .from(pullRequestEvidenceSnapshots)
      .where(
        and(
          eq(pullRequestEvidenceSnapshots.repositoryId, repositoryId),
          eq(pullRequestEvidenceSnapshots.pullRequestNumber, pullRequestNumber),
        ),
      )
      .orderBy(desc(pullRequestEvidenceSnapshots.id))
      .limit(1)
      .get()
    return row ? this.snapshot(row, pullRequest.headRevision) : null
  }

  private snapshot(row: typeof pullRequestEvidenceSnapshots.$inferSelect, currentHeadRevision: string): PullRequestEvidenceSnapshot {
    const freshness = row.headRevision === currentHeadRevision ? 'current' : 'stale'
    return {
      id: row.id,
      repositoryId: row.repositoryId,
      pullRequestNumber: row.pullRequestNumber,
      headRevision: row.headRevision,
      policyVersion: row.policyVersion,
      readiness: freshness === 'stale' ? 'stale' : (row.readiness as PullRequestReadiness),
      freshness,
      entries: arrayValue(row.entries),
      counts: recordValue(row.counts),
      digest: row.digest,
      createdAt: row.createdAt,
    }
  }
}

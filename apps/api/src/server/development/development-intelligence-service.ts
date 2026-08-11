import { createHash } from 'node:crypto'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type {
  DevelopmentArtifactReference,
  DevelopmentConfidence,
  DevelopmentIntelligenceOverview,
  DevelopmentInvestigation,
  DevelopmentKnowledgeEntry,
  DevelopmentKnowledgeKind,
  DevelopmentKnowledgeScope,
  DevelopmentKnowledgeStatus,
  DevelopmentRelatedArtifact,
} from '@vertexade/platform-contracts'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { repositoryKnowledgeEntries } from '../database/schema/development-tables.ts'
import { jobs, workItemResources, workItems, workResources } from '../database/schema/tables.ts'

const knowledgeKinds = ['fact', 'decision', 'constraint', 'risk', 'pattern', 'ownership'] as const
const knowledgeScopes = ['repository', 'path', 'boundary'] as const
const knowledgeConfidences = ['high', 'medium', 'low'] as const

type KnowledgeRow = typeof repositoryKnowledgeEntries.$inferSelect

function record(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function boundedText(value: unknown, label: string, maximum: number, required = true): string {
  const result = String(value ?? '').trim()
  if ((required && !result) || result.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
    throw new Error(`${label} must contain ${required ? '1' : '0'}–${maximum} valid characters`)
  }
  return result
}

function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) throw new Error(`${label} is invalid`)
  return value as T
}

function optionalPositiveInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${label} must be a positive integer`)
  return result
}

function normalizedRepositoryPath(value: unknown, required: boolean): string | null {
  const path = boundedText(value, 'Path', 1_000, required).replaceAll('\\', '/').replace(/^\.\//, '')
  if (!path) return null
  if (path.startsWith('/') || path.split('/').includes('..')) throw new Error('Path must be repository-relative')
  return path
}

function summary(value: unknown): string | null {
  const normalized = String(value || '')
    .replace(/```[\s\S]*?```/g, ' Code excerpt omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[\*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return null
  return normalized.length > 500 ? `${normalized.slice(0, 497).trimEnd()}...` : normalized
}

export class DevelopmentIntelligenceService {
  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly notify: (reason: string, repositoryId: number) => void = () => undefined,
  ) {}

  private knowledgeRecord(row: KnowledgeRow, currentRevision: string): DevelopmentKnowledgeEntry {
    return {
      id: row.id,
      repositoryId: row.repositoryId,
      kind: row.kind as DevelopmentKnowledgeKind,
      scope: row.scope as DevelopmentKnowledgeScope,
      title: row.title,
      summary: row.summary,
      path: row.path,
      boundaryKey: row.boundaryKey,
      confidence: row.confidence as DevelopmentConfidence,
      status: row.status as DevelopmentKnowledgeStatus,
      source: {
        kind: row.sourceArtifactKind as DevelopmentArtifactReference['kind'],
        id: row.sourceArtifactId,
        repositoryId: row.repositoryId,
        revision: row.sourceRevision,
        digest: row.sourceDigest,
        label: `${row.sourceArtifactKind === 'impact_analysis' ? 'Impact analysis' : 'Architecture index'} #${row.sourceArtifactId}`,
        jobId: row.sourceJobId,
        workItemId: row.sourceWorkItemId,
      },
      supersedesEntryId: row.supersedesEntryId,
      actor: row.actor,
      freshness: row.sourceRevision === currentRevision ? 'current' : 'stale',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    }
  }

  listKnowledge(repositoryId: number, currentRevision: string, includeArchived = false): DevelopmentKnowledgeEntry[] {
    const rows = this.database
      .select()
      .from(repositoryKnowledgeEntries)
      .where(
        includeArchived
          ? eq(repositoryKnowledgeEntries.repositoryId, repositoryId)
          : and(eq(repositoryKnowledgeEntries.repositoryId, repositoryId), ne(repositoryKnowledgeEntries.status, 'archived')),
      )
      .orderBy(desc(repositoryKnowledgeEntries.updatedAt), desc(repositoryKnowledgeEntries.id))
      .limit(250)
      .all()
    return rows.map((row) => this.knowledgeRecord(row, currentRevision))
  }

  private sourceWorkItem(artifact: DevelopmentArtifactReference, sourceJobId: number): number {
    const source = this.database
      .select({ workItemId: jobs.workItemId })
      .from(jobs)
      .innerJoin(workItems, eq(workItems.id, jobs.workItemId))
      .innerJoin(workItemResources, eq(workItemResources.workItemId, workItems.id))
      .innerJoin(workResources, eq(workResources.id, workItemResources.resourceId))
      .where(
        and(
          eq(jobs.id, sourceJobId),
          eq(jobs.repoId, artifact.repositoryId),
          eq(workItems.kind, 'investigation'),
          eq(workResources.provider, 'core'),
          eq(workResources.kind, artifact.kind),
          eq(workResources.externalId, String(artifact.id)),
        ),
      )
      .get()
    if (!source?.workItemId) throw new Error('The source thread is not an investigation for this artifact')
    return source.workItemId
  }

  createKnowledge(artifact: DevelopmentArtifactReference, input: Record<string, unknown>): DevelopmentKnowledgeEntry {
    const kind = choice(input.kind, knowledgeKinds, 'Knowledge kind')
    const scope = choice(input.scope, knowledgeScopes, 'Knowledge scope')
    const confidence = choice(input.confidence, knowledgeConfidences, 'Confidence')
    const path = normalizedRepositoryPath(input.path, scope === 'path')
    const boundaryKey = boundedText(input.boundaryKey, 'Boundary key', 500, scope === 'boundary') || null
    const sourceJobId = optionalPositiveInteger(input.sourceJobId, 'Source job ID')
    const sourceWorkItemId = sourceJobId ? this.sourceWorkItem(artifact, sourceJobId) : null
    const supersedesEntryId = optionalPositiveInteger(input.supersedesEntryId, 'Superseded entry ID')
    if (supersedesEntryId) {
      const existing = this.database
        .select({ id: repositoryKnowledgeEntries.id, status: repositoryKnowledgeEntries.status })
        .from(repositoryKnowledgeEntries)
        .where(
          and(eq(repositoryKnowledgeEntries.id, supersedesEntryId), eq(repositoryKnowledgeEntries.repositoryId, artifact.repositoryId)),
        )
        .get()
      if (!existing || existing.status !== 'accepted') throw new Error('Only accepted knowledge in this repository can be superseded')
    }
    const id = this.database.transaction((transaction) => {
      const result = transaction
        .insert(repositoryKnowledgeEntries)
        .values({
          repositoryId: artifact.repositoryId,
          kind,
          scope,
          title: boundedText(input.title, 'Title', 200),
          summary: boundedText(input.summary, 'Summary', 10_000),
          path,
          boundaryKey,
          confidence,
          status: 'accepted',
          sourceArtifactKind: artifact.kind,
          sourceArtifactId: artifact.id,
          sourceRevision: artifact.revision,
          sourceDigest: artifact.digest,
          sourceJobId,
          sourceWorkItemId,
          supersedesEntryId,
          actor: boundedText(input.actor || 'operator', 'Actor', 200),
        })
        .run()
      if (supersedesEntryId) {
        transaction
          .update(repositoryKnowledgeEntries)
          .set({ status: 'superseded', updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(repositoryKnowledgeEntries.id, supersedesEntryId))
          .run()
      }
      return Number(result.lastInsertRowid)
    })
    this.notify('repository_knowledge_accepted', artifact.repositoryId)
    const stored = this.database.select().from(repositoryKnowledgeEntries).where(eq(repositoryKnowledgeEntries.id, id)).get()
    if (!stored) throw new Error('Accepted repository knowledge could not be read back')
    return this.knowledgeRecord(stored, artifact.revision)
  }

  archiveKnowledge(repositoryId: number, entryId: number): DevelopmentKnowledgeEntry | null {
    const result = this.database
      .update(repositoryKnowledgeEntries)
      .set({ status: 'archived', archivedAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(repositoryKnowledgeEntries.id, entryId), eq(repositoryKnowledgeEntries.repositoryId, repositoryId)))
      .run()
    if (!Number(result.changes)) return null
    this.notify('repository_knowledge_archived', repositoryId)
    const stored = this.database.select().from(repositoryKnowledgeEntries).where(eq(repositoryKnowledgeEntries.id, entryId)).get()
    return stored ? this.knowledgeRecord(stored, stored.sourceRevision) : null
  }

  investigations(artifact: DevelopmentArtifactReference): DevelopmentInvestigation[] {
    return this.database
      .select({
        jobId: jobs.id,
        workItemId: workItems.id,
        workItemKey: workItems.key,
        title: workItems.title,
        status: jobs.status,
        agentId: jobs.agentId,
        model: jobs.agentModel,
        reasoningEffort: jobs.agentReasoningEffort,
        latestActivity: jobs.latestActivity,
        resultText: jobs.resultText,
        createdAt: jobs.createdAt,
        finishedAt: jobs.finishedAt,
        metadata: workResources.metadata,
      })
      .from(workResources)
      .innerJoin(workItemResources, eq(workItemResources.resourceId, workResources.id))
      .innerJoin(workItems, eq(workItems.id, workItemResources.workItemId))
      .innerJoin(jobs, eq(jobs.workItemId, workItems.id))
      .where(
        and(
          eq(workResources.provider, 'core'),
          eq(workResources.kind, artifact.kind),
          eq(workResources.externalId, String(artifact.id)),
          eq(workResources.repositoryId, artifact.repositoryId),
          eq(workItems.kind, 'investigation'),
          eq(jobs.repoId, artifact.repositoryId),
        ),
      )
      .orderBy(desc(jobs.id))
      .limit(50)
      .all()
      .map((row) => {
        const metadata = record(row.metadata)
        return {
          jobId: row.jobId,
          workItemId: row.workItemId,
          workItemKey: row.workItemKey || `W-${String(row.workItemId).padStart(4, '0')}`,
          title: row.title,
          status: row.status,
          agentId: row.agentId,
          model: row.model,
          reasoningEffort: row.reasoningEffort,
          latestActivity: row.latestActivity,
          resultSummary: summary(row.resultText),
          revision: String(metadata.revision || artifact.revision),
          digest: String(metadata.digest || artifact.digest),
          createdAt: row.createdAt,
          finishedAt: row.finishedAt,
        }
      })
  }

  overview(artifact: DevelopmentArtifactReference, relatedArtifacts: DevelopmentRelatedArtifact[]): DevelopmentIntelligenceOverview {
    const knowledge = this.listKnowledge(artifact.repositoryId, artifact.revision)
    const accepted = knowledge
      .filter((entry) => entry.status === 'accepted')
      .sort((left, right) => left.id - right.id)
      .map((entry) => ({ id: entry.id, digest: entry.source.digest, title: entry.title, summary: entry.summary }))
    return {
      artifact,
      investigations: this.investigations(artifact),
      knowledge,
      relatedArtifacts,
      acceptedKnowledgeDigest: createHash('sha256').update(JSON.stringify(accepted)).digest('hex'),
    }
  }

  promptKnowledge(repositoryId: number, revision: string): string {
    const accepted = this.listKnowledge(repositoryId, revision)
      .filter((entry) => entry.status === 'accepted')
      .slice(0, 100)
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        scope: entry.scope,
        title: entry.title,
        summary: entry.summary,
        path: entry.path,
        boundaryKey: entry.boundaryKey,
        confidence: entry.confidence,
        freshness: entry.freshness,
        sourceRevision: entry.source.revision,
        sourceDigest: entry.source.digest,
      }))
    return JSON.stringify(accepted, null, 2)
  }
}

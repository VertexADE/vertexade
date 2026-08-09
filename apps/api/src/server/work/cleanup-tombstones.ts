import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, workCleanupArtifacts, workCleanupTombstones } from '../database/schema/tables.ts'
import { and, asc, eq, inArray, lte, ne, or, sql } from 'drizzle-orm'

export type CleanupArtifactKind = 'log' | 'provider_thread' | 'worktree' | 'branch' | 'memory' | 'workspace_root'
export type CleanupArtifactState = 'pending' | 'retrying' | 'blocked' | 'detached' | 'complete'

export type CleanupArtifactInput = {
  identity: string
  jobId?: number
  kind: CleanupArtifactKind
  target: string
  metadata?: Record<string, unknown>
}

type CleanupArtifactRecord = CleanupArtifactInput & {
  id: number
  tombstoneId: number
  state: CleanupArtifactState
  attempts: number
  nextRetryAt: string | null
  lastError: string | null
}

export function ensureCleanupSchema(database: { exec(sql: string): void }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS work_cleanup_tombstones (
      id INTEGER PRIMARY KEY, work_item_id INTEGER NOT NULL, work_key TEXT NOT NULL, work_title TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT, last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS work_cleanup_tombstones_due ON work_cleanup_tombstones(state,next_retry_at);
    CREATE TABLE IF NOT EXISTS work_cleanup_artifacts (
      id INTEGER PRIMARY KEY, tombstone_id INTEGER NOT NULL REFERENCES work_cleanup_tombstones(id) ON DELETE CASCADE,
      identity TEXT NOT NULL, job_id INTEGER, kind TEXT NOT NULL, target TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT, last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
      UNIQUE(tombstone_id,identity)
    );
    CREATE INDEX IF NOT EXISTS work_cleanup_artifacts_due ON work_cleanup_artifacts(state,next_retry_at);
  `)
}

function retryAt(attempts: number) {
  const delay = Math.min(60 * 60_000, 5_000 * 2 ** Math.min(attempts, 8))
  return new Date(Date.now() + delay).toISOString()
}

function artifactRecord(row: typeof workCleanupArtifacts.$inferSelect): CleanupArtifactRecord {
  return {
    id: row.id,
    tombstoneId: row.tombstoneId,
    identity: row.identity,
    jobId: row.jobId ?? undefined,
    kind: row.kind as CleanupArtifactKind,
    target: row.target,
    metadata: row.metadata,
    state: row.state as CleanupArtifactState,
    attempts: row.attempts,
    nextRetryAt: row.nextRetryAt,
    lastError: row.lastError,
  }
}

export class CleanupTombstoneStore {
  constructor(private readonly database: DrizzleDashboardDatabase) {}

  ensure(workItem: { id: number; key: string; title: string }, artifacts: CleanupArtifactInput[]) {
    return this.database.transaction((transaction) => {
      let tombstone = transaction
        .select()
        .from(workCleanupTombstones)
        .where(and(eq(workCleanupTombstones.workItemId, workItem.id), ne(workCleanupTombstones.state, 'complete')))
        .orderBy(asc(workCleanupTombstones.id))
        .get()
      if (!tombstone) {
        const inserted = transaction
          .insert(workCleanupTombstones)
          .values({ workItemId: workItem.id, workKey: workItem.key, workTitle: workItem.title })
          .returning()
          .get()
        tombstone = inserted
      }
      for (const artifact of artifacts)
        transaction
          .insert(workCleanupArtifacts)
          .values({
            tombstoneId: tombstone.id,
            identity: artifact.identity,
            jobId: artifact.jobId,
            kind: artifact.kind,
            target: artifact.target,
            metadata: artifact.metadata || {},
          })
          .onConflictDoNothing({ target: [workCleanupArtifacts.tombstoneId, workCleanupArtifacts.identity] })
          .run()
      return tombstone.id
    })
  }

  artifact(tombstoneId: number, identity: string) {
    const row = this.database
      .select()
      .from(workCleanupArtifacts)
      .where(and(eq(workCleanupArtifacts.tombstoneId, tombstoneId), eq(workCleanupArtifacts.identity, identity)))
      .get()
    return row ? artifactRecord(row) : null
  }

  artifacts(tombstoneId: number, states?: CleanupArtifactState[]) {
    const condition = states?.length
      ? and(eq(workCleanupArtifacts.tombstoneId, tombstoneId), inArray(workCleanupArtifacts.state, states))
      : eq(workCleanupArtifacts.tombstoneId, tombstoneId)
    return this.database
      .select()
      .from(workCleanupArtifacts)
      .where(condition)
      .orderBy(asc(workCleanupArtifacts.id))
      .all()
      .map(artifactRecord)
  }

  complete(tombstoneId: number, identity: string) {
    const current = this.artifact(tombstoneId, identity)
    if (!current || ['complete', 'detached'].includes(current.state)) return this.refresh(tombstoneId)
    this.database
      .update(workCleanupArtifacts)
      .set({
        state: 'complete',
        lastError: null,
        nextRetryAt: null,
        completedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(workCleanupArtifacts.tombstoneId, tombstoneId), eq(workCleanupArtifacts.identity, identity)))
      .run()
    return this.refresh(tombstoneId)
  }

  fail(tombstoneId: number, identity: string, error: unknown, blocked = false) {
    const current = this.artifact(tombstoneId, identity)
    if (!current || ['complete', 'detached'].includes(current.state)) return this.refresh(tombstoneId)
    const attempts = (current?.attempts || 0) + 1
    const text = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
    this.database
      .update(workCleanupArtifacts)
      .set({
        state: blocked ? 'blocked' : 'retrying',
        attempts,
        lastError: text,
        nextRetryAt: blocked ? null : retryAt(attempts),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(workCleanupArtifacts.tombstoneId, tombstoneId), eq(workCleanupArtifacts.identity, identity)))
      .run()
    return this.refresh(tombstoneId)
  }

  retargetJobLog(tombstoneId: number, identity: string, jobId: number, source: string, target: string) {
    this.database.transaction((transaction) => {
      transaction
        .insert(workCleanupArtifacts)
        .values({
          tombstoneId,
          identity: `job:${jobId}:legacy-source`,
          jobId,
          kind: 'log',
          target: source,
          metadata: { legacySource: true },
        })
        .onConflictDoNothing({ target: [workCleanupArtifacts.tombstoneId, workCleanupArtifacts.identity] })
        .run()
      transaction.update(jobs).set({ logPath: target }).where(eq(jobs.id, jobId)).run()
      transaction
        .update(workCleanupArtifacts)
        .set({ target, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(workCleanupArtifacts.tombstoneId, tombstoneId), eq(workCleanupArtifacts.identity, identity)))
        .run()
    })
  }

  detach(artifactId: number, workKey: string) {
    const row = this.database.select().from(workCleanupArtifacts).where(eq(workCleanupArtifacts.id, artifactId)).get()
    if (!row || row.state !== 'blocked') return null
    const tombstone = this.database.select().from(workCleanupTombstones).where(eq(workCleanupTombstones.id, row.tombstoneId)).get()
    if (!tombstone || tombstone.workKey.toLowerCase() !== workKey.trim().toLowerCase()) return null
    this.database
      .update(workCleanupArtifacts)
      .set({ state: 'detached', nextRetryAt: null, completedAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workCleanupArtifacts.id, artifactId))
      .run()
    this.refresh(row.tombstoneId)
    return this.artifact(row.tombstoneId, row.identity)
  }

  refresh(tombstoneId: number) {
    const artifacts = this.artifacts(tombstoneId)
    const incomplete = artifacts.filter((artifact) => !['complete', 'detached'].includes(artifact.state))
    const blocked = incomplete.find((artifact) => artifact.state === 'blocked')
    const state = incomplete.length ? (blocked ? 'blocked' : 'retrying') : 'complete'
    const nextRetryAt = incomplete
      .map((artifact) => artifact.nextRetryAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0]
    const lastError = blocked?.lastError || incomplete.find((artifact) => artifact.lastError)?.lastError || null
    this.database
      .update(workCleanupTombstones)
      .set({
        state,
        attempts: sql`${workCleanupTombstones.attempts} + 1`,
        nextRetryAt: nextRetryAt || null,
        lastError,
        completedAt: state === 'complete' ? sql`CURRENT_TIMESTAMP` : null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(workCleanupTombstones.id, tombstoneId))
      .run()
    return this.summary(tombstoneId)
  }

  summary(tombstoneId: number) {
    const tombstone = this.database.select().from(workCleanupTombstones).where(eq(workCleanupTombstones.id, tombstoneId)).get()
    if (!tombstone) return null
    const artifacts = this.artifacts(tombstoneId)
    return {
      id: tombstone.id,
      work_item_id: tombstone.workItemId,
      work_item_key: tombstone.workKey,
      state: tombstone.state,
      pending: artifacts.filter((artifact) => !['complete', 'detached'].includes(artifact.state)).length,
      next_retry_at: tombstone.nextRetryAt,
      last_error: tombstone.lastError,
      artifacts,
    }
  }

  dueWorkItemIds(limit = 10) {
    const now = new Date().toISOString()
    return this.database
      .select({ workItemId: workCleanupTombstones.workItemId })
      .from(workCleanupTombstones)
      .where(
        and(
          inArray(workCleanupTombstones.state, ['pending', 'retrying']),
          or(sql`${workCleanupTombstones.nextRetryAt} IS NULL`, lte(workCleanupTombstones.nextRetryAt, now)),
        ),
      )
      .orderBy(asc(workCleanupTombstones.id))
      .limit(limit)
      .all()
      .map((row) => row.workItemId)
  }

  listIncomplete() {
    return this.database
      .select({ id: workCleanupTombstones.id })
      .from(workCleanupTombstones)
      .where(ne(workCleanupTombstones.state, 'complete'))
      .orderBy(asc(workCleanupTombstones.id))
      .all()
      .map((row) => this.summary(row.id)!)
  }
}

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { workContextTransfers, workItems } from '../database/schema/tables.ts'
import { text, type CreateContextTransferInput, type WorkNotifier } from './work-model.ts'
import { workContextTransferRecord } from './records.ts'

type EventWriter = (workItemId: number, eventType: string, summary: string, actor?: string, payload?: unknown) => void

export class WorkContextTransferService {
  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly exists: (workItemId: number) => boolean,
    private readonly event: EventWriter,
    private readonly notify: WorkNotifier,
  ) {}

  create(input: CreateContextTransferInput) {
    if (!this.exists(input.workItemId) || !this.exists(input.sourceWorkItemId) || !this.exists(input.destinationWorkItemId)) {
      throw new Error('Every context transfer work item must exist')
    }
    const result = this.database
      .insert(workContextTransfers)
      .values({
        workItemId: input.workItemId,
        sourceWorkItemId: input.sourceWorkItemId,
        destinationWorkItemId: input.destinationWorkItemId,
        sourceJobId: input.sourceJobId,
        destinationJobId: input.destinationJobId,
        instruction: text(input.instruction, 20_000),
        contextSnapshot: text(input.contextSnapshot, 200_000),
      })
      .run()
    const id = Number(result.lastInsertRowid)
    this.event(input.workItemId, 'context_transfer_created', 'Prepared output handoff to an existing worktree', 'user', {
      transferId: id,
      sourceJobId: input.sourceJobId,
      destinationJobId: input.destinationJobId,
    })
    this.notify('work_context_transfer_created', input.workItemId)
    return this.get(id)
  }

  start(id: number) {
    const transfer = this.get(id)
    if (!transfer) throw new Error('Context transfer not found')
    this.database
      .update(workContextTransfers)
      .set({ status: 'running', startedAt: sql`CURRENT_TIMESTAMP`, error: null })
      .where(eq(workContextTransfers.id, id))
      .run()
    this.database
      .update(workItems)
      .set({ state: 'active', attention: null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workItems.id, transfer.work_item_id))
      .run()
    this.event(transfer.work_item_id, 'context_transfer_started', 'Sent source output to the destination worktree', 'system', {
      transferId: id,
      destinationJobId: transfer.destination_job_id,
    })
    this.notify('work_context_transfer_started', transfer.work_item_id)
    return this.get(id)
  }

  fail(id: number, error: unknown) {
    const transfer = this.get(id)
    if (!transfer || ['completed', 'failed'].includes(transfer.status)) return transfer
    const message = text(error instanceof Error ? error.message : error, 2000, 'Context transfer failed')
    this.database
      .update(workContextTransfers)
      .set({ status: 'failed', error: message, finishedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workContextTransfers.id, id))
      .run()
    this.database
      .update(workItems)
      .set({ attention: message, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workItems.id, transfer.work_item_id))
      .run()
    this.event(transfer.work_item_id, 'context_transfer_failed', message, 'system', { transferId: id })
    this.notify('work_context_transfer_failed', transfer.work_item_id)
    return this.get(id)
  }

  finishForJob(destinationJobId: number, successful: boolean, output: unknown, error?: unknown) {
    const transfers = this.database
      .select()
      .from(workContextTransfers)
      .where(and(eq(workContextTransfers.destinationJobId, destinationJobId), inArray(workContextTransfers.status, ['pending', 'running'])))
      .orderBy(asc(workContextTransfers.id))
      .all()
      .map(workContextTransferRecord)
    for (const transfer of transfers) {
      if (!successful) {
        this.fail(transfer.id, error)
        continue
      }
      const snapshot = text(output, 200_000)
      this.database
        .update(workContextTransfers)
        .set({ status: 'completed', outputSnapshot: snapshot || null, error: null, finishedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(workContextTransfers.id, transfer.id))
        .run()
      this.database
        .update(workItems)
        .set({ state: 'done', attention: null, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(workItems.id, transfer.work_item_id))
        .run()
      this.event(transfer.work_item_id, 'context_transfer_completed', 'Destination worktree completed the follow-up', 'system', {
        transferId: transfer.id,
        destinationJobId,
      })
      this.notify('work_context_transfer_completed', transfer.work_item_id)
    }
    return transfers.length
  }

  get(id: number) {
    const row = this.database.select().from(workContextTransfers).where(eq(workContextTransfers.id, id)).get()
    return row ? workContextTransferRecord(row) : null
  }

  list(workItemId: number) {
    return this.database
      .select({
        id: workContextTransfers.id,
        work_item_id: workContextTransfers.workItemId,
        source_work_item_id: workContextTransfers.sourceWorkItemId,
        destination_work_item_id: workContextTransfers.destinationWorkItemId,
        source_job_id: workContextTransfers.sourceJobId,
        destination_job_id: workContextTransfers.destinationJobId,
        status: workContextTransfers.status,
        instruction: workContextTransfers.instruction,
        error: workContextTransfers.error,
        created_at: workContextTransfers.createdAt,
        started_at: workContextTransfers.startedAt,
        finished_at: workContextTransfers.finishedAt,
        context_size: sql<number>`length(${workContextTransfers.contextSnapshot})`,
        output_captured: sql<number>`case when ${workContextTransfers.outputSnapshot} is null then 0 else 1 end`,
      })
      .from(workContextTransfers)
      .where(eq(workContextTransfers.workItemId, workItemId))
      .orderBy(desc(workContextTransfers.id))
      .all()
  }
}

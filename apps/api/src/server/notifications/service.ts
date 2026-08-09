import { count, desc, eq, isNull, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, notifications, workItems } from '../database/schema/tables.ts'

export type NotificationInput = {
  jobId?: number | null
  automationRecipeId?: number | null
}

export class NotificationService {
  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly notify: (reason: string, id?: number | null) => void,
  ) {}

  create(kind: string, title: string, message: unknown, { jobId = null, automationRecipeId = null }: NotificationInput = {}) {
    const result = this.database
      .insert(notifications)
      .values({ kind, title, message: String(message || '').slice(0, 2_000), jobId, automationRecipeId })
      .run()
    this.notify('notification', jobId)
    return Number(result.lastInsertRowid)
  }

  list() {
    const rows = this.database
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title: notifications.title,
        message: notifications.message,
        job_id: notifications.jobId,
        automation_recipe_id: notifications.automationRecipeId,
        read_at: notifications.readAt,
        created_at: notifications.createdAt,
        work_item_id: jobs.workItemId,
        work_item_key: workItems.key,
      })
      .from(notifications)
      .leftJoin(jobs, eq(jobs.id, notifications.jobId))
      .leftJoin(workItems, eq(workItems.id, jobs.workItemId))
      .orderBy(desc(notifications.id))
      .limit(100)
      .all()
    const unread = this.database.select({ count: count() }).from(notifications).where(isNull(notifications.readAt)).get()
    return { notifications: rows, unread_count: Number(unread?.count || 0) }
  }

  markAllRead() {
    this.database
      .update(notifications)
      .set({ readAt: sql`CURRENT_TIMESTAMP` })
      .where(isNull(notifications.readAt))
      .run()
    this.notify('notifications_read')
  }

  dismiss(id: number) {
    const result = this.database.delete(notifications).where(eq(notifications.id, id)).run()
    if (!result.changes) return false
    this.notify('notification_dismissed', id)
    return true
  }

  prune() {
    const result = this.database.delete(notifications).run()
    this.notify('notifications_pruned')
    return Number(result.changes)
  }
}

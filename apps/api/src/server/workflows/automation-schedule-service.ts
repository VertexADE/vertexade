import type { AutomationRecipe, AutomationSchedule, TriggerEvent } from '@vertexade/platform-contracts'
import { CronExpressionParser } from 'cron-parser'
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { automationRecipes, automationSchedules, repositories } from '../database/schema/tables.ts'
import { generalWorkspaceRepository } from '../work/general-workspace.ts'

const simpleSchedules = { hourly: '0 * * * *', daily: '0 9 * * *', weekly: '0 9 * * 1' } as const
const branchTypes = new Set(['feature', 'fix', 'chore', 'refactor', 'test', 'docs'])

function nextScheduledRun(expression: string, timezone: string, currentDate = new Date()) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(currentDate)
    return CronExpressionParser.parse(expression, { tz: timezone, currentDate }).next().toDate().toISOString()
  } catch (error) {
    throw new Error(`Invalid schedule: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function normalizeAutomationSchedule(value: unknown, database: DrizzleDashboardDatabase): AutomationSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Scheduled automations require schedule settings')
  const input = value as Record<string, unknown>
  const repositoryIds = [...new Set((Array.isArray(input.repositoryIds) ? input.repositoryIds : []).map(Number).filter(Number.isInteger))]
  const branchType = String(input.branchType || 'chore')
    .trim()
    .toLowerCase()
  const scheduleMode = input.scheduleMode === 'cron' ? 'cron' : 'simple'
  const simpleSchedule = String(input.simpleSchedule || 'daily') as keyof typeof simpleSchedules
  if (repositoryIds.length > 8) throw new Error('Choose no more than 8 repositories')
  if (!branchTypes.has(branchType)) throw new Error('Choose a valid branch type')
  if (scheduleMode === 'simple' && !Object.hasOwn(simpleSchedules, simpleSchedule)) throw new Error('Choose hourly, daily, or weekly')
  const cronExpression = scheduleMode === 'simple' ? simpleSchedules[simpleSchedule] : String(input.cronExpression || '').trim()
  if (!cronExpression) throw new Error('Cron expression is required')
  const timezone = String(input.timezone || 'UTC').trim()
  const found = database.select({ id: repositories.id }).from(repositories).where(inArray(repositories.id, repositoryIds)).all()
  if (found.length !== repositoryIds.length) throw new Error('One or more repositories no longer exist')
  return {
    repositoryIds,
    executionMode: input.executionMode === 'independent' ? 'independent' : 'unified',
    branchType,
    scheduleMode,
    simpleSchedule: scheduleMode === 'simple' ? simpleSchedule : null,
    cronExpression,
    timezone,
    nextRunAt: nextScheduledRun(cronExpression, timezone),
    agentId: String(input.agentId || '').trim() || null,
    model: String(input.model || '').trim() || null,
    reasoningEffort: String(input.reasoningEffort || '').trim() || null,
    allowSubagents: Boolean(input.allowSubagents),
  }
}

export function saveAutomationSchedule(database: DrizzleDashboardDatabase, recipeId: number, schedule: AutomationSchedule) {
  const values = {
    repositoryIds: schedule.repositoryIds,
    executionMode: schedule.executionMode,
    branchType: schedule.branchType,
    scheduleMode: schedule.scheduleMode,
    simpleSchedule: schedule.simpleSchedule,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    nextRunAt: schedule.nextRunAt,
    agentId: schedule.agentId,
    model: schedule.model,
    reasoningEffort: schedule.reasoningEffort,
    allowSubagents: schedule.allowSubagents ? 1 : 0,
  }
  database
    .insert(automationSchedules)
    .values({ recipeId, ...values })
    .onConflictDoUpdate({ target: automationSchedules.recipeId, set: values })
    .run()
}

type ScheduleRuntimeDependencies = {
  database: DrizzleDashboardDatabase
  notify(reason: string, id?: number | null): void
  recipe(id: number): AutomationRecipe | null
  execute(recipe: AutomationRecipe, trigger: TriggerEvent): Promise<AutomationRecipe>
}

export class AutomationScheduleService {
  readonly #running = new Set<number>()

  constructor(private readonly dependencies: ScheduleRuntimeDependencies) {}

  async run(current: AutomationRecipe, reason: 'manual' | 'scheduled') {
    const schedule = current.schedule
    if (!schedule) throw new Error('Automation recipe is not scheduled')
    if (this.#running.has(current.id)) throw new Error('This scheduled automation is already starting')
    this.#running.add(current.id)
    const startedAt = new Date()
    const nextRunAt = nextScheduledRun(schedule.cronExpression, schedule.timezone, new Date(startedAt.getTime() + 1_000))
    const { database, notify } = this.dependencies
    database.update(automationSchedules).set({ nextRunAt }).where(eq(automationSchedules.recipeId, current.id)).run()
    notify('automation_schedule_started', current.id)
    const errors: string[] = []
    let started = 0
    try {
      const repositoryIds = schedule.executionMode === 'unified' ? schedule.repositoryIds.slice(0, 1) : schedule.repositoryIds
      const targets = repositoryIds.length ? repositoryIds : [null]
      for (const repositoryId of targets) {
        const targetId = repositoryId ?? generalWorkspaceRepository(database).id
        const repository = database.select().from(repositories).where(eq(repositories.id, targetId)).get()
        if (!repository) {
          errors.push(`Repository ${repositoryId} was not found`)
          continue
        }
        try {
          const result = await this.dependencies.execute(current, this.event(current, repository, startedAt))
          if (result.lastStatus === 'failed')
            errors.push(`${repository.fullName}: ${result.lastError || 'Automation flow failed to start'}`)
          else started += 1
        } catch (error) {
          errors.push(`${repository.fullName}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      database
        .update(automationRecipes)
        .set({
          lastRunAt: startedAt.toISOString(),
          lastStatus: errors.length ? 'failed' : 'running',
          lastError: errors.join('\n') || null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(automationRecipes.id, current.id))
        .run()
      notify(errors.length ? 'automation_schedule_failed' : 'automation_schedule_finished', current.id)
      return { recipe: this.dependencies.recipe(current.id)!, reason, started, errors, nextRunAt }
    } finally {
      this.#running.delete(current.id)
    }
  }

  startTimers() {
    setTimeout(() => void this.processDue(), 2_000).unref()
    setInterval(() => void this.processDue(), 30_000).unref()
  }

  private event(current: AutomationRecipe, repository: typeof repositories.$inferSelect, startedAt: Date): TriggerEvent {
    const schedule = current.schedule!
    return {
      id: `schedule:${current.id}:${startedAt.toISOString()}:${repository.id}`,
      occurredAt: startedAt.toISOString(),
      subject: `repository:${repository.id}`,
      data: {
        reason: 'automation_schedule_due',
        entityType: 'repository',
        entityId: repository.id,
        entity: {
          id: repository.id,
          full_name: repository.fullName,
          title: `${current.name} · ${startedAt.toISOString().slice(0, 10)}`,
        },
        launch: {
          branchType: schedule.branchType,
          agentId: schedule.agentId,
          model: schedule.model,
          reasoningEffort: schedule.reasoningEffort,
          allowSubagents: schedule.allowSubagents,
          repositoryIds: schedule.executionMode === 'unified' ? schedule.repositoryIds : undefined,
          workKind: 'operational',
          source: {
            provider: 'vertexade',
            kind: 'schedule',
            externalId: `${current.id}:${startedAt.toISOString()}:${repository.id}`,
            role: 'source',
            label: current.name,
            state: 'running',
            primary: true,
            metadata: { automationRecipeId: current.id, firedAt: startedAt.toISOString() },
          },
        },
      },
    }
  }

  private async processDue() {
    const { database, notify } = this.dependencies
    const due = database
      .select({ recipeId: automationSchedules.recipeId })
      .from(automationSchedules)
      .innerJoin(automationRecipes, eq(automationRecipes.id, automationSchedules.recipeId))
      .where(
        and(
          eq(automationRecipes.enabled, 1),
          or(isNull(automationSchedules.nextRunAt), lte(automationSchedules.nextRunAt, new Date().toISOString())),
        ),
      )
      .all()
    for (const { recipeId } of due) {
      const recipe = this.dependencies.recipe(recipeId)
      if (!recipe?.schedule) continue
      if (!recipe.schedule.nextRunAt) {
        saveAutomationSchedule(database, recipe.id, {
          ...recipe.schedule,
          nextRunAt: nextScheduledRun(recipe.schedule.cronExpression, recipe.schedule.timezone),
        })
        continue
      }
      try {
        await this.run(recipe, 'scheduled')
      } catch (error) {
        database
          .update(automationRecipes)
          .set({ lastStatus: 'failed', lastError: error instanceof Error ? error.message : String(error) })
          .where(eq(automationRecipes.id, recipe.id))
          .run()
        notify('automation_schedule_failed', recipe.id)
      }
    }
  }
}

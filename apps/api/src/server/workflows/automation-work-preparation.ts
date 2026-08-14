import { eq } from 'drizzle-orm'
import { repositoryRecord } from '../database/contract-records.ts'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { repositories } from '../database/schema/tables.ts'
import type { WorkService } from '../work/service.ts'
import type { AutomationThreadLaunchOptions, WorkTarget } from './automation-thread-launcher.ts'

type ResourceSelectionWriter = Pick<import('../agents/resources.ts').AgentResourceService, 'setSelection'>

function selectedRepositories(database: DrizzleDashboardDatabase, ids: number[] | undefined) {
  if (!ids?.length) return undefined
  return ids.flatMap((id) => {
    const row = database.select().from(repositories).where(eq(repositories.id, id)).get()
    return row ? [repositoryRecord(row)] : []
  })
}

function resourceWorkItem(
  work: WorkService,
  resources: () => ResourceSelectionWriter,
  target: WorkTarget,
  options: AutomationThreadLaunchOptions,
) {
  if (!options.resourceSelection) return null
  const item = work.ensureRepositoryTask(target.repository, target.title, { workItemId: target.workItemId })
  resources().setSelection(item.id, options.resourceSelection)
  return item
}

export function createAutomationWorkPreparation(
  database: DrizzleDashboardDatabase,
  work: WorkService,
  resources: () => ResourceSelectionWriter,
) {
  return (target: WorkTarget, options: AutomationThreadLaunchOptions) => {
    const selected = selectedRepositories(database, options.repositoryIds)
    const item = resourceWorkItem(work, resources, target, options)
    return {
      repositories: selected?.length ? selected : target.repositories,
      workItemId: item?.id || target.workItemId,
    }
  }
}

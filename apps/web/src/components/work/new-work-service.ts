import { toast } from 'sonner'
import type { AgentResourceSelection } from '@vertexade/ui/components/agent-resource-picker'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'
import type { WorkBoardData, WorkItem, WorkLaunchResult } from '@vertexade/ui/lib/dashboard-types'

const workDraftKey = 'vertexade.new-work-draft'
const workLaunchPreferencesKey = 'vertexade.work-launch-preferences'

export type NewWorkDraft = {
  title: string
  description: string
  kind: WorkItem['kind']
  priority: WorkItem['priority']
  repositories: number[]
  startThread: boolean
  createPr: boolean
  splitWorkItem: boolean
}

export type WorkLaunchPreferences = {
  repositories: number[]
  createPr: boolean
  splitWorkItem: boolean
}

export function readNewWorkDraft() {
  try {
    return JSON.parse(localStorage.getItem(workDraftKey) || '{}') as Partial<NewWorkDraft>
  } catch {
    localStorage.removeItem(workDraftKey)
    return {}
  }
}

export function writeNewWorkDraft(draft: NewWorkDraft) {
  localStorage.setItem(workDraftKey, JSON.stringify(draft))
}

export function clearNewWorkDraft() {
  localStorage.removeItem(workDraftKey)
}

export function readWorkLaunchPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(workLaunchPreferencesKey) || '{}') as Partial<WorkLaunchPreferences>
    return {
      repositories: Array.isArray(stored.repositories)
        ? stored.repositories
            .map(Number)
            .filter((value) => Number.isInteger(value) && value > 0)
            .slice(0, 8)
        : [],
      createPr: stored.createPr ?? true,
      splitWorkItem: stored.splitWorkItem ?? false,
    } satisfies WorkLaunchPreferences
  } catch {
    localStorage.removeItem(workLaunchPreferencesKey)
    return { repositories: [], createPr: true, splitWorkItem: false } satisfies WorkLaunchPreferences
  }
}

export function rememberWorkLaunchPreferences(preferences: WorkLaunchPreferences) {
  if (!preferences.repositories.length) return
  localStorage.setItem(workLaunchPreferencesKey, JSON.stringify(preferences))
}

export function suggestedWorkRepositories(data: WorkBoardData, draftRepositories: number[] = [], rememberedRepositories: number[] = []) {
  const available = new Set(data.repositories.map((repository) => repository.id))
  const valid = (ids: number[]) => ids.filter((id) => available.has(id))
  const draft = valid(draftRepositories)
  if (draft.length) return draft
  const remembered = valid(rememberedRepositories)
  if (remembered.length) return remembered
  if (data.repositories.length === 1) return [data.repositories[0]!.id]
  const recent = [...data.items]
    .filter((item) => !item.archived_at && item.primary_repository_id && available.has(item.primary_repository_id))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]
  return recent?.primary_repository_id ? [recent.primary_repository_id] : []
}

export async function requestGeneratedWorkTitle(description: string, kind: WorkItem['kind'], backendId?: string) {
  const result = await backendApi<{ title: string }>(backendId, '/api/content-generation/work-item-title', {
    method: 'POST',
    body: JSON.stringify({ context: description, kind }),
  })
  return result.title
}

export function resourceSelectionPayload(resourceSelection: AgentResourceSelection | null) {
  return resourceSelection ? { resource_selection: resourceSelection } : {}
}

export async function launchCreatedWork(
  item: WorkItem,
  options: {
    startThread: boolean
    repositories: number[]
    description: string
    createPr: boolean
    splitWorkItem: boolean
    resources: object
  },
) {
  if (!options.startThread) return null
  return backendApi<WorkLaunchResult>(item.backend_id, `/api/work-items/${item.id}/threads`, {
    method: 'POST',
    body: JSON.stringify({
      repository_ids: options.repositories,
      prompt: options.description,
      create_pr: options.createPr,
      split_work_item: options.splitWorkItem,
      ...options.resources,
    }),
  })
}

export function notifyWorkCreated(item: WorkItem, result: WorkLaunchResult | null) {
  if (!result) {
    toast.success(`${item.key} added to Work`)
    return
  }
  if (result.errors.length) {
    toast.warning(`${item.key} was created, but its agent needs attention`)
    return
  }
  toast.success(`${item.key} created and its agent started`)
}

export function notifyWorkLaunchRecovery(item: WorkItem) {
  toast.warning(`${item.key} was created, but its agent could not start. Retry from this Work item.`)
}

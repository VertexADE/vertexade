import { parseJsonResponse } from '@vertexade/platform-server/http'
import { runApiEffect } from '@vertexade/platform-server/effect'
import { resilientFetch } from '@vertexade/platform-server/effect'
import { Effect } from 'effect'
import { azureRequestEffect } from './effect.ts'

const API_VERSION = '7.1'

export const AZURE_BACKLOG_WORK_ITEM_TYPES = ['User Story', 'Product Backlog Item', 'Requirement', 'Issue'] as const
export const AZURE_BOARD_WORK_ITEM_TYPES = [...AZURE_BACKLOG_WORK_ITEM_TYPES, 'Task'] as const

export function azureBoardWorkItemTypes(availableTypes: readonly string[]) {
  const available = new Set(availableTypes)
  return AZURE_BOARD_WORK_ITEM_TYPES.filter((type) => available.has(type))
}

export function isAzureBacklogWorkItemType(value: unknown): value is (typeof AZURE_BACKLOG_WORK_ITEM_TYPES)[number] {
  return AZURE_BACKLOG_WORK_ITEM_TYPES.includes(value as (typeof AZURE_BACKLOG_WORK_ITEM_TYPES)[number])
}

export function isAzureBoardWorkItemType(value: unknown): value is (typeof AZURE_BOARD_WORK_ITEM_TYPES)[number] {
  return AZURE_BOARD_WORK_ITEM_TYPES.includes(value as (typeof AZURE_BOARD_WORK_ITEM_TYPES)[number])
}

type JsonObject = Record<string, any>
export type AzureConfig = {
  configured: boolean
  url: string
  project: string
  pat: string
  webhookSecret: string
}
export type Iteration = {
  id: string
  name: string
  path: string
  start_date: string | null
  finish_date: string | null
  timeframe: string | null
}
export type WorkItemCreateInput = {
  type: string
  title: string
  iterationPath: string
  assignedTo?: string
  description?: string
  acceptanceCriteria?: string
  areaPath?: string
  tags?: string[]
  parentId?: number | string
}

function cleanBaseUrl(value: unknown) {
  const url = new URL(String(value || '').trim())
  if (url.protocol !== 'https:') throw new Error('Azure DevOps URL must use HTTPS')
  return url.toString().replace(/\/$/, '')
}

export function azureConfig(input: Record<string, unknown> = {}) {
  const url = String(input.url || '').trim()
  const project = String(input.project || '').trim()
  const pat = String(input.pat || '').trim()
  const webhookSecret = String(input.webhook_secret || input.webhookSecret || '').trim()
  return {
    configured: Boolean(url && project && pat),
    url: url ? cleanBaseUrl(url) : '',
    project,
    pat,
    webhookSecret,
  }
}

function field(item: JsonObject, name: string): any {
  return item.fields?.[name] ?? null
}

function firstValue(...values: unknown[]) {
  return values.find((value) => Boolean(value))
}

function identityName(value: any) {
  if (!value) return null
  return firstValue(value.displayName, value.uniqueName, String(value))
}

function assignedIdentity(value: any) {
  if (!value) return null
  return {
    display_name: firstValue(value.displayName, value.uniqueName, String(value)),
    unique_name: firstValue(value.uniqueName, value.displayName, String(value)),
    image_url: value.imageUrl ?? null,
  }
}

function hierarchyRelationIds(item: JsonObject, relationType: string) {
  return (item.relations ?? [])
    .filter((relation: JsonObject) => relation.rel === relationType)
    .flatMap((relation: JsonObject) => relation.url?.match(/(\d+)$/)?.[1] ?? [])
}

export function normalizeWorkItem(item: JsonObject) {
  const assigned = field(item, 'System.AssignedTo')
  return {
    id: item.id,
    rev: item.rev,
    title: firstValue(field(item, 'System.Title'), `Work item ${item.id}`),
    type: field(item, 'System.WorkItemType') ?? '',
    state: field(item, 'System.State') ?? '',
    iteration_path: field(item, 'System.IterationPath') ?? '',
    area_path: field(item, 'System.AreaPath') ?? '',
    tags: String(field(item, 'System.Tags') ?? '')
      .split(';')
      .map((tag) => tag.trim())
      .filter(Boolean),
    assigned_to: assignedIdentity(assigned),
    description: field(item, 'System.Description') ?? '',
    acceptance_criteria: field(item, 'Microsoft.VSTS.Common.AcceptanceCriteria') ?? '',
    priority: field(item, 'Microsoft.VSTS.Common.Priority'),
    story_points: field(item, 'Microsoft.VSTS.Scheduling.StoryPoints'),
    effort: field(item, 'Microsoft.VSTS.Scheduling.Effort'),
    original_estimate: field(item, 'Microsoft.VSTS.Scheduling.OriginalEstimate'),
    remaining_work: field(item, 'Microsoft.VSTS.Scheduling.RemainingWork'),
    completed_work: field(item, 'Microsoft.VSTS.Scheduling.CompletedWork'),
    created_at: field(item, 'System.CreatedDate'),
    changed_at: field(item, 'System.ChangedDate'),
    created_by: identityName(field(item, 'System.CreatedBy')),
    changed_by: identityName(field(item, 'System.ChangedBy')),
    url: item._links?.html?.href ?? null,
    parent_id: hierarchyRelationIds(item, 'System.LinkTypes.Hierarchy-Reverse')[0] ?? null,
    child_ids: hierarchyRelationIds(item, 'System.LinkTypes.Hierarchy-Forward'),
  }
}

function iterationTimeframe(attributes: any = {}) {
  const now = Date.now()
  const start = attributes.startDate ? new Date(attributes.startDate).getTime() : null
  const finish = attributes.finishDate ? new Date(attributes.finishDate).getTime() : null
  if (start && finish && now >= start && now <= finish) return 'current'
  if (start && now < start) return 'future'
  if (finish && now > finish) return 'past'
  return null
}

function classificationIterations(root: JsonObject) {
  const result: Iteration[] = []
  function visit(node: JsonObject) {
    const path = String(node.path || '')
      .replace(/^\\/, '')
      .replace(/\\Iteration(?=\\|$)/i, '')
    if (node !== root && path)
      result.push({
        id: node.identifier || String(node.id),
        name: node.name,
        path,
        start_date: node.attributes?.startDate || null,
        finish_date: node.attributes?.finishDate || null,
        timeframe: iterationTimeframe(node.attributes),
      })
    for (const child of node.children || []) visit(child)
  }
  visit(root)
  return sortIterations(result)
}

function sortIterations(items: Iteration[]) {
  const rank: Record<string, number> = { current: 0, future: 1, past: 2 }
  return items.sort((left, right) => {
    const timeframe = (rank[left.timeframe || ''] ?? 3) - (rank[right.timeframe || ''] ?? 3)
    if (timeframe) return timeframe
    if (left.timeframe === 'current') return right.path.split('\\').length - left.path.split('\\').length
    if (left.timeframe === 'future') return String(left.start_date || '').localeCompare(String(right.start_date || ''))
    if (left.timeframe === 'past') return String(right.finish_date || '').localeCompare(String(left.finish_date || ''))
    return left.path.localeCompare(right.path)
  })
}

export class AzureDevOpsClient {
  config: AzureConfig
  fetch: typeof globalThis.fetch
  constructor(config: AzureConfig, fetchImpl = globalThis.fetch) {
    if (!config.configured) throw new Error('Azure Boards is not configured')
    this.config = config
    this.fetch = fetchImpl
  }

  endpoint(path: string, projectScoped = true) {
    const project = projectScoped ? `/${encodeURIComponent(this.config.project)}` : ''
    const separator = path.includes('?') ? '&' : '?'
    return `${this.config.url}${project}${path}${separator}api-version=${API_VERSION}`
  }

  async request(path: string, options: any = {}, projectScoped = true): Promise<any> {
    const response = await resilientFetch({
      service: 'Azure DevOps',
      fetch: this.fetch,
      url: this.endpoint(path, projectScoped),
      init: {
        ...options,
        headers: {
          authorization: `Basic ${Buffer.from(`:${this.config.pat}`).toString('base64')}`,
          accept: 'application/json',
          ...options.headers,
        },
      },
    })
    return parseJsonResponse(response, 'Azure DevOps')
  }

  async iterations(signal?: AbortSignal): Promise<Iteration[]> {
    const data = await this.request('/_apis/work/teamsettings/iterations', { signal })
    const assigned: Iteration[] = (data.value || []).map((item: JsonObject) => ({
      id: item.id,
      name: item.name,
      path: item.path,
      start_date: item.attributes?.startDate || null,
      finish_date: item.attributes?.finishDate || null,
      timeframe: item.attributes?.timeFrame || null,
    }))
    if (assigned.length) return sortIterations(assigned)
    const tree = await this.request('/_apis/wit/classificationnodes/Iterations?$depth=10', {
      signal,
    })
    return classificationIterations(tree)
  }

  async query(query: string, signal?: AbortSignal): Promise<number[]> {
    const data = await this.request('/_apis/wit/wiql', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    return (data.workItems || []).map((item: JsonObject) => Number(item.id))
  }

  async workItems(ids: number[], signal?: AbortSignal) {
    if (!ids.length) return []
    const batches = []
    for (let index = 0; index < ids.length; index += 200) {
      batches.push(ids.slice(index, index + 200))
    }
    const responses = await runApiEffect(
      Effect.forEach(
        batches,
        (batch) =>
          azureRequestEffect('work-item-batch', (batchSignal) =>
            this.request('/_apis/wit/workitemsbatch', {
              method: 'POST',
              signal: signal ? AbortSignal.any([signal, batchSignal]) : batchSignal,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                ids: batch,
                $expand: 'Relations',
              }),
            }),
          ),
        { concurrency: 4 },
      ),
    )
    return responses.flatMap((data) => (data.value || []).map(normalizeWorkItem))
  }

  async workItem(id: number | string, signal?: AbortSignal) {
    const item = await this.request(`/_apis/wit/workitems/${Number(id)}?$expand=Relations`, {
      signal,
    })
    return normalizeWorkItem(item)
  }

  async sprintItems(iterationPath: string, signal?: AbortSignal, availableTypes: readonly string[] = AZURE_BOARD_WORK_ITEM_TYPES) {
    const types = azureBoardWorkItemTypes(availableTypes)
    if (!types.length) return []
    const safePath = String(iterationPath).replaceAll("'", "''")
    const typeList = types.map((type) => `'${type.replaceAll("'", "''")}'`).join(', ')
    const ids = await this.query(
      `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.IterationPath] UNDER '${safePath}' AND [System.WorkItemType] IN (${typeList}) ORDER BY [System.ChangedDate] DESC`,
      signal,
    )
    return this.workItems(ids, signal)
  }

  async features(signal?: AbortSignal, availableTypes?: readonly string[]) {
    if (availableTypes && !availableTypes.includes('Feature')) return []
    const ids = await this.query(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = 'Feature' AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC",
      signal,
    )
    return this.workItems(ids, signal)
  }

  async workItemTypes(signal?: AbortSignal) {
    const data = await this.request('/_apis/wit/workitemtypes', { signal })
    return (data.value || []).map((item: JsonObject) => item.name)
  }

  async workItemStates(type: string, signal?: AbortSignal) {
    const data = await this.request(`/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states`, {
      signal,
    })
    return (data.value || []).map((state: JsonObject) => state.name).filter(Boolean)
  }

  async teams(signal?: AbortSignal) {
    const data = await this.request(`/_apis/projects/${encodeURIComponent(this.config.project)}/teams`, { signal }, false)
    return data.value || []
  }

  async teamIterations(team: string, signal?: AbortSignal) {
    const data = await this.request(`/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations`, { signal })
    return data.value || []
  }

  async taskboardColumns(team: string, signal?: AbortSignal) {
    const data = await this.request(`/${encodeURIComponent(team)}/_apis/work/taskboardcolumns`, {
      signal,
    })
    return (data.columns || []).sort((left: JsonObject, right: JsonObject) => Number(left.order) - Number(right.order))
  }

  async taskboardItems(team: string, iterationId: string, signal?: AbortSignal) {
    const data = await this.request(`/${encodeURIComponent(team)}/_apis/work/taskboardworkitems/${encodeURIComponent(iterationId)}`, {
      signal,
    })
    return Array.isArray(data) ? data : data.value || []
  }

  async moveTaskboardItem(team: string, iterationId: string, workItemId: number | string, column: string) {
    return this.request(
      `/${encodeURIComponent(team)}/_apis/work/taskboardworkitems/${encodeURIComponent(iterationId)}/${Number(workItemId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newColumn: column }),
      },
    )
  }

  async updateWorkItemState(id: number | string, state: string) {
    const item = await this.request(`/_apis/wit/workitems/${Number(id)}?$expand=Relations`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json-patch+json' },
      body: JSON.stringify([{ op: 'add', path: '/fields/System.State', value: state }]),
    })
    return normalizeWorkItem(item)
  }

  async createWorkItem({
    type,
    title,
    iterationPath,
    assignedTo,
    description,
    acceptanceCriteria,
    areaPath,
    tags,
    parentId,
  }: WorkItemCreateInput) {
    const patch: JsonObject[] = [
      { op: 'add', path: '/fields/System.Title', value: title },
      { op: 'add', path: '/fields/System.IterationPath', value: iterationPath },
    ]
    if (assignedTo) patch.push({ op: 'add', path: '/fields/System.AssignedTo', value: assignedTo })
    if (description) patch.push({ op: 'add', path: '/fields/System.Description', value: description })
    if (acceptanceCriteria && type !== 'Task')
      patch.push({
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria',
        value: acceptanceCriteria,
      })
    if (areaPath) patch.push({ op: 'add', path: '/fields/System.AreaPath', value: areaPath })
    if (tags?.length) patch.push({ op: 'add', path: '/fields/System.Tags', value: tags.join('; ') })
    if (parentId)
      patch.push({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `${this.config.url}/${encodeURIComponent(this.config.project)}/_apis/wit/workItems/${Number(parentId)}`,
          attributes: { comment: 'Linked by VertexADE' },
        },
      })
    const item = await this.request(`/_apis/wit/workitems/$${encodeURIComponent(type)}?$expand=Relations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json-patch+json' },
      body: JSON.stringify(patch),
    })
    return normalizeWorkItem(item)
  }
}

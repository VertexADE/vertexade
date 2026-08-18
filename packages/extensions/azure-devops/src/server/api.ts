import { Effect } from 'effect'
import type { ExtensionRegistrationContext, ExtensionRepository, WorkManagementProvider } from '@vertexade/platform-contracts'
import { runApiEffect } from '@vertexade/platform-server/effect'
import { loadExtensionData, publishExtensionChange } from '@vertexade/platform-server/extension-data'
import { HttpError, readJsonObject } from '@vertexade/platform-server/http'
import { agentSafetyBoundary } from '@vertexade/platform-server/prompts'
import type { AzureExtensionHostServices } from './host-contract.ts'
import type { CacheRefreshTrigger } from '@vertexade/platform-server/cache-trigger'
import {
  AzureDevOpsClient,
  isAzureBacklogWorkItemType,
  isAzureBoardWorkItemType,
  type AzureConfig,
  type WorkItemCreateInput,
} from './client.ts'
import { AZURE_WEBHOOK_USERNAME, handleAzureWebhook } from './webhook.ts'
import { extensionWebhookDependencies } from '@vertexade/platform-server/webhooks'
import { azureRequestEffect } from './effect.ts'
import { loadAzureBoardData, portableAzureDetail, portableAzureItem } from './board.ts'
import { parseAzureStoryManifest, planningRequest, refinementPrompt } from './planning.ts'
import { proxyAzureAvatar } from './avatar.ts'

export { azurePortableGroupOrder, selectAzureIterationItems } from './board.ts'
export { parseAzureStoryManifest } from './planning.ts'

type AzureProvider = WorkManagementProvider<AzureConfig, AzureDevOpsClient>
type AzureTeam = { name: string }
type AzureApiContext = {
  provider: AzureProvider
  host: AzureExtensionHostServices
  refreshTrigger: CacheRefreshTrigger
  settings(): AzureConfig
}

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function firstText(...values: unknown[]) {
  return values.map(text).find(Boolean) ?? ''
}

export function azureSettings(provider: AzureProvider, host: AzureExtensionHostServices) {
  return provider.normalizeConfig(host.settings.read('config', { url: '', project: '', pat: '', webhookSecret: '' }))
}

function publicAzureSettings(config: AzureConfig, host: AzureExtensionHostServices) {
  return {
    configured: config.configured,
    stored: host.settings.has('config'),
    url: config.url,
    project: config.project,
    has_pat: Boolean(config.pat),
    has_webhook_secret: Boolean(config.webhookSecret),
    webhook_path: '/api/extensions/azure-devops/webhook',
    webhook_username: AZURE_WEBHOOK_USERNAME,
  }
}

function requiredAzureConfig(context: AzureApiContext, message = 'Azure Boards is not configured') {
  const config = context.settings()
  if (!config.configured) throw new HttpError(message, 503)
  return config
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function repositoryIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter(Number.isInteger))].slice(0, 20)
}

function selectedRepositories(ids: number[], context: AzureApiContext) {
  const repositories = ids
    .map((id) => context.host.repositories.get(id))
    .filter((repository): repository is ExtensionRepository => Boolean(repository))
  if (repositories.length !== ids.length) {
    throw new HttpError('One or more selected repositories no longer exist', 400)
  }
  return repositories
}

function checkedPrompt(value: unknown, label = 'Prompt') {
  const prompt = String(value || '').trim()
  if (!prompt || prompt.length > 20_000) {
    throw new HttpError(`${label} must contain 1–20,000 characters`, 400)
  }
  return prompt
}

function requestedAzureSettings(input: Record<string, unknown>, current: AzureConfig) {
  const requestedUrl = text(input.url).trim()
  const suppliedPat = text(input.pat).trim()
  return {
    url: requestedUrl,
    project: text(input.project).trim(),
    pat: suppliedPat || (requestedUrl.replace(/\/$/, '') === current.url ? current.pat : ''),
    webhookSecret: text(input.webhook_secret).trim() || current.webhookSecret,
  }
}

function normalizedAzureSettings(value: Record<string, unknown>, context: AzureApiContext) {
  let config: AzureConfig
  try {
    config = context.provider.normalizeConfig(value)
  } catch (error) {
    throw new HttpError(errorMessage(error), 400)
  }
  if (!config.configured) {
    throw new HttpError('Organization URL, project, and personal access token are required', 400)
  }
  return config
}

async function verifyAzureSettings(config: AzureConfig, context: AzureApiContext) {
  try {
    await context.provider.createClient(config).iterations()
  } catch (error) {
    throw new HttpError(errorMessage(error), 400)
  }
}

async function saveAzureSettings(request: Request, context: AzureApiContext) {
  const input = await readJsonObject(request)
  const value = requestedAzureSettings(input, context.settings())
  const config = normalizedAzureSettings(value, context)
  await verifyAzureSettings(config, context)
  context.host.settings.write('config', value)
  publishExtensionChange(context.host, 'azure_settings_updated')
  return Response.json(publicAzureSettings(config, context.host))
}

function deleteAzureSettings(context: AzureApiContext) {
  context.host.settings.delete('config')
  publishExtensionChange(context.host, 'azure_settings_deleted')
  return Response.json(publicAzureSettings(context.provider.normalizeConfig({}), context.host))
}

function emptyAzureBoard(config: AzureConfig) {
  return {
    configured: false,
    project: config.project || null,
    iterations: [],
    features: [],
    items: [],
    portable_items: [],
    portable_group_fields: [],
  }
}

async function loadAzureBoard(request: Request, context: AzureApiContext) {
  const config = context.settings()
  if (!config.configured) return Response.json(emptyAzureBoard(config))

  const search = new URL(request.url).searchParams
  const iterationPath = String(search.get('iteration') || '').trim()
  const forceRefresh = search.get('force_refresh') === '1'
  const key = `board:${iterationPath.slice(0, 220) || 'current'}`
  const loader = async () => {
    const value = await loadAzureBoardData(context.provider, config, iterationPath)
    context.refreshTrigger.emitRefresh({
      force: forceRefresh,
      provider: 'azure-devops',
      key,
      subject: `azure-devops:iteration:${value.selected_iteration || 'current'}`,
      data: {
        count: value.items.length,
        iteration: value.selected_iteration,
      },
    })
    return value
  }
  const result = await loadExtensionData(context.host, key, loader, forceRefresh)

  return Response.json({
    ...result.value,
    repositories: context.host.repositories.list(),
    portable_items: result.value.items.map((item: any) =>
      portableAzureItem(item, result.value.states_by_type, {
        taskboard: {
          columns: result.value.taskboard_columns,
          team: result.value.selected_team,
          iterationId: result.value.selected_iteration_id,
        },
      }),
    ),
    ...(result.cache ? { cache: result.cache } : {}),
  })
}

async function prepareAzurePlan(request: Request, context: AzureApiContext) {
  const config = requiredAzureConfig(context, 'Configure Azure DevOps in Settings first')
  const input = await readJsonObject(request)
  const prompt = checkedPrompt(input.prompt)
  const iterationPath = String(input.iteration_path || '').trim()
  if (!iterationPath) throw new HttpError('Choose a sprint', 400)

  const repositories = selectedRepositories(repositoryIds(input.repository_ids), context)
  const job = await context.host.tasks.plan(planningRequest(repositories, prompt, iterationPath, config))
  return Response.json(job, { status: 202 })
}

function azurePlanningStatus(jobId: string, context: AzureApiContext) {
  const job = context.host.tasks.planningJob(Number(jobId), 'planning')
  if (!job) throw new HttpError('Planning task not found', 404)

  let drafts
  let error
  if (job.status === 'completed') {
    try {
      drafts = parseAzureStoryManifest(job.result_text)
    } catch (cause) {
      error = errorMessage(cause)
    }
  }
  const { result_text: _resultText, latest_diff: _latestDiff, ...safeJob } = job
  return Response.json({ job: safeJob, drafts, error })
}

async function refineAzurePlan(request: Request, jobId: string, context: AzureApiContext) {
  const job = context.host.tasks.planningJob(Number(jobId), 'planning')
  if (!job) throw new HttpError('Planning task not found', 404)
  if (job.status !== 'completed' || !job.thread_id) {
    throw new HttpError('Wait for the current planning turn to complete', 409)
  }

  const input = await readJsonObject(request)
  const instruction = checkedPrompt(input.prompt, 'Refinement prompt')
  const story = input.story && typeof input.story === 'object' ? input.story : null
  const result = await context.host.tasks.refinePlan({
    job,
    prompt: refinementPrompt(instruction, story),
    activity: 'Refining Azure sprint drafts…',
    event: 'azure_plan_refinement_started',
  })
  return Response.json(result, { status: 202 })
}

function workItemTags(value: unknown) {
  if (Array.isArray(value)) return value.map(String)
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function draftWorkItem(draft: any, input: Record<string, unknown>, iterationPath: string): WorkItemCreateInput {
  const storyType = isAzureBacklogWorkItemType(input.story_type) ? input.story_type : 'User Story'
  return {
    type: storyType,
    title: String(draft.title).trim(),
    iterationPath,
    assignedTo: String(draft.assigned_to || '').trim(),
    description: String(draft.description || '').trim(),
    acceptanceCriteria: String(draft.acceptance_criteria || '').trim(),
    areaPath: String(draft.area_path || '').trim(),
    tags: workItemTags(draft.tags),
    parentId: Number(draft.feature_id),
  }
}

function subtaskWorkItem(task: any, parent: { id: number; area_path?: string }, iterationPath: string): WorkItemCreateInput {
  return {
    type: 'Task',
    title: String(task.title).trim().slice(0, 255),
    iterationPath,
    assignedTo: String(task.assigned_to || '').trim(),
    description: String(task.description || '').trim(),
    areaPath: String(task.area_path || parent.area_path || '').trim(),
    tags: workItemTags(task.tags),
    parentId: parent.id,
  }
}

function selectedDrafts(input: Record<string, unknown>) {
  if (!Array.isArray(input.stories)) {
    throw new HttpError('Choose a sprint and include story drafts', 400)
  }
  return input.stories.slice(0, 50).filter((draft) => draft?.selected !== false)
}

function checkedDraft(draft: any) {
  const title = text(draft?.title).trim()
  const featureId = Number(draft?.feature_id)
  if (!title || title.length > 255 || !featureId) {
    throw new HttpError('Every selected story needs a title and feature', 400)
  }
  return draft
}

function selectedSubtasks(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).filter((task) => task?.selected !== false && Boolean(text(task?.title).trim()))
}

async function createDraftWithSubtasks(client: AzureDevOpsClient, draft: any, input: Record<string, unknown>, iterationPath: string) {
  const story = await client.createWorkItem(draftWorkItem(checkedDraft(draft), input, iterationPath))
  const subtasks = []
  for (const task of selectedSubtasks(draft.subtasks)) {
    subtasks.push(await client.createWorkItem(subtaskWorkItem(task, story, iterationPath)))
  }
  return { story, subtasks }
}

async function createAzureDrafts(request: Request, context: AzureApiContext) {
  const config = requiredAzureConfig(context, 'Configure Azure DevOps in Settings first')
  const input = await readJsonObject(request)
  const iterationPath = text(input.iteration_path).trim()
  if (!iterationPath) {
    throw new HttpError('Choose a sprint and include story drafts', 400)
  }

  const client = context.provider.createClient(config)
  const created = []
  for (const draft of selectedDrafts(input)) {
    created.push(await createDraftWithSubtasks(client, draft, input, iterationPath))
  }

  if (!created.length) {
    throw new HttpError('Select at least one story to create', 400)
  }
  publishExtensionChange(context.host, 'azure_work_items_created')
  return Response.json({ created }, { status: 201 })
}

function supportedWorkItemType(value: unknown) {
  const type = text(value)
  if (!isAzureBoardWorkItemType(type)) {
    throw new HttpError('Choose a supported backlog item or task type', 400)
  }
  return type
}

function requiredWorkItemTitle(value: unknown) {
  const title = text(value).trim()
  if (!title || title.length > 255) {
    throw new HttpError('Title must contain 1–255 characters', 400)
  }
  return title
}

function requiredIterationPath(value: unknown) {
  const iterationPath = text(value).trim()
  if (!iterationPath) throw new HttpError('Choose a sprint', 400)
  return iterationPath
}

function requiredParentId(value: unknown, type: string) {
  const parentId = Number(value || 0) || null
  if (!parentId) {
    throw new HttpError(type === 'Task' ? 'Choose the parent story' : 'Choose the parent feature', 400)
  }
  return parentId
}

function requestedAzureItem(input: Record<string, unknown>): WorkItemCreateInput {
  const type = supportedWorkItemType(input.type)
  const title = requiredWorkItemTitle(input.title)
  const iterationPath = requiredIterationPath(input.iteration_path)
  const parentId = requiredParentId(input.parent_id, type)

  return {
    type,
    title,
    iterationPath,
    assignedTo: text(input.assigned_to).trim(),
    description: text(input.description).trim(),
    areaPath: text(input.area_path).trim(),
    tags: workItemTags(input.tags),
    parentId,
  }
}

async function createAzureItem(request: Request, context: AzureApiContext) {
  const config = requiredAzureConfig(context, 'Configure Azure DevOps in Settings first')
  const input = await readJsonObject(request)
  const item = await context.provider.createClient(config).createWorkItem(requestedAzureItem(input))
  publishExtensionChange(context.host, 'azure_work_item_created')
  return Response.json(item, { status: 201 })
}

async function createAzureSubtasks(request: Request, itemId: string, context: AzureApiContext) {
  const config = requiredAzureConfig(context)
  const input = await readJsonObject(request)
  const stories = Array.isArray(input.stories) ? input.stories : []
  const story = stories[0]
  if (!story || !Array.isArray(story.subtasks)) {
    throw new HttpError('The planning result did not contain subtasks', 400)
  }

  const client = context.provider.createClient(config)
  const parent = await client.workItem(Number(itemId))
  const created = []
  for (const task of selectedSubtasks(story.subtasks)) {
    created.push(await client.createWorkItem(subtaskWorkItem(task, parent, parent.iteration_path)))
  }
  if (!created.length) {
    throw new HttpError('Select at least one subtask to create', 400)
  }

  publishExtensionChange(context.host, 'azure_work_items_created')
  return Response.json({ created }, { status: 201 })
}

async function prepareAzureSubtasks(request: Request, itemId: string, context: AzureApiContext) {
  const config = requiredAzureConfig(context)
  const input = await readJsonObject(request)
  const instruction = checkedPrompt(input.prompt)
  const client = context.provider.createClient(config)
  const item = await client.workItem(Number(itemId))
  if (!isAzureBacklogWorkItemType(item.type)) {
    throw new HttpError('Choose a backlog item', 400)
  }
  const repositories = selectedRepositories(repositoryIds(input.repository_ids), context)
  const prompt = `Suggest only implementation subtasks for Azure ${item.type} #${item.id}: ${item.title}.\n\nWork-item description:\n${item.description || 'No description provided.'}\n\nAcceptance criteria:\n${item.acceptance_criteria || 'No acceptance criteria provided.'}\n\nAdditional request:\n${instruction}\n\nReturn exactly one story entry representing this backlog item, with the suggestions in its subtasks array. Do not propose unrelated work items.`
  const job = await context.host.tasks.plan(planningRequest(repositories, prompt, item.iteration_path, config))
  return Response.json(job, { status: 202 })
}

async function moveAzureBoardItem(request: Request, itemId: string, context: AzureApiContext) {
  const config = requiredAzureConfig(context)
  const input = await readJsonObject(request)
  const iterationId = String(input.iteration_id || '').trim()
  const column = String(input.column || '').trim()
  const team = String(input.team || '').trim()
  if (!iterationId || !column || !team) {
    throw new HttpError('Choose a team, sprint, and board column', 400)
  }

  const client = context.provider.createClient(config)
  if (!(await client.teams()).some((item: any) => item.name === team)) {
    throw new HttpError('Choose a valid Azure team', 400)
  }
  if (!(await client.taskboardColumns(team)).some((item: any) => item.name === column)) {
    throw new HttpError('Choose a valid Azure taskboard column', 400)
  }

  const id = Number(itemId)
  await client.moveTaskboardItem(team, iterationId, id, column)
  publishExtensionChange(context.host, 'azure_taskboard_column_changed', id)
  return Response.json({ id, column })
}

async function changeAzureItemState(request: Request, itemId: string, context: AzureApiContext) {
  const config = requiredAzureConfig(context)
  const input = await readJsonObject(request)
  const state = String(input.state || '').trim()
  const client = context.provider.createClient(config)
  const current = await client.workItem(Number(itemId))
  if (!isAzureBoardWorkItemType(current.type)) {
    throw new HttpError('Only backlog items and tasks can change state here', 400)
  }
  if (!(await client.workItemStates(current.type)).includes(state)) {
    throw new HttpError('Choose a valid state for this work item type', 400)
  }

  const item = await client.updateWorkItemState(current.id, state)
  publishExtensionChange(context.host, 'azure_work_item_state_changed', current.id)
  return Response.json(item)
}

async function loadAzureItem(itemId: string, context: AzureApiContext) {
  const config = requiredAzureConfig(context)
  const client = context.provider.createClient(config)
  const item = await client.workItem(Number(itemId))
  const children = item.child_ids?.length ? await client.workItems(item.child_ids) : []
  return Response.json(portableAzureDetail(item, children))
}

async function launchAzureItemTask(request: Request, itemId: string, context: AzureApiContext) {
  const config = requiredAzureConfig(context)
  const input = await readJsonObject(request)
  const repository = context.host.repositories.get(Number(input.repository_id))
  if (!repository) throw new HttpError('Choose a repository', 404)

  const [item] = await context.provider.createClient(config).workItems([Number(itemId)])
  if (!item || !isAzureBoardWorkItemType(item.type)) {
    throw new HttpError('Backlog item or task not found', 404)
  }

  const title = `${item.type} ${item.id}: ${item.title}`.slice(0, 100)
  const workItemUrl = item.url || `${config.url}/${encodeURIComponent(config.project)}/_workitems/edit/${item.id}`
  const prompt = `Implement Azure Boards ${item.type} #${item.id}: ${item.title}.\n\nProject: ${config.project}\nSprint: ${item.iteration_path}\nAssigned to: ${item.assigned_to?.display_name || 'Unassigned'}\nWork item: ${workItemUrl}\n\n${item.description || 'Read the work item in Azure Boards for complete acceptance criteria and deliver the requested outcome.'}`
  const task = await context.host.tasks.launch(repository, title, prompt, input.create_pr !== false, 'feature', {
    workspaceMode: 'combined',
    source: {
      provider: 'azure-devops',
      kind: 'work_item',
      externalId: String(item.id),
      role: 'source',
      label: item.title,
      url: item.url,
      state: item.state,
      primary: true,
      metadata: { type: item.type },
    },
  })
  return Response.json(task, { status: 202 })
}

export function registerAzureDevOpsApi(
  registration: ExtensionRegistrationContext,
  provider: AzureProvider,
  host: AzureExtensionHostServices,
  refreshTrigger: CacheRefreshTrigger,
) {
  const settings = () => azureSettings(provider, host)
  const context = { provider, host, refreshTrigger, settings }
  const webhook = extensionWebhookDependencies(host, settings)

  registration.routes.register({
    method: 'GET',
    path: '/settings',
    availability: 'installed',
    handler: () => Response.json(publicAzureSettings(settings(), host)),
  })
  registration.routes.register({
    method: 'POST',
    path: '/settings',
    availability: 'installed',
    handler: (request) => saveAzureSettings(request, context),
  })
  registration.routes.register({
    method: 'DELETE',
    path: '/settings',
    availability: 'installed',
    handler: () => deleteAzureSettings(context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/webhook',
    handler: (request) => handleAzureWebhook(request, webhook),
  })
  registration.routes.register({
    method: 'GET',
    path: '/avatar',
    handler: (request) => proxyAzureAvatar(request, requiredAzureConfig(context)),
  })
  registration.routes.register({
    method: 'GET',
    path: '/board',
    handler: (request) => loadAzureBoard(request, context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/prepare',
    handler: (request) => prepareAzurePlan(request, context),
  })
  registration.routes.register({
    method: 'GET',
    path: '/prepare/:jobId',
    handler: (_request, { params }) => azurePlanningStatus(params.jobId ?? '', context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/prepare/:jobId/refine',
    handler: (request, { params }) => refineAzurePlan(request, params.jobId ?? '', context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/drafts',
    handler: (request) => createAzureDrafts(request, context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/items',
    handler: (request) => createAzureItem(request, context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/items/:itemId/subtasks',
    handler: (request, { params }) => createAzureSubtasks(request, params.itemId ?? '', context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/items/:itemId/prepare-subtasks',
    handler: (request, { params }) => prepareAzureSubtasks(request, params.itemId ?? '', context),
  })
  registration.routes.register({
    method: 'PATCH',
    path: '/items/:itemId/column',
    handler: (request, { params }) => moveAzureBoardItem(request, params.itemId ?? '', context),
  })
  registration.routes.register({
    method: 'PATCH',
    path: '/items/:itemId/state',
    handler: (request, { params }) => changeAzureItemState(request, params.itemId ?? '', context),
  })
  registration.routes.register({
    method: 'GET',
    path: '/items/:itemId',
    handler: (_request, { params }) => loadAzureItem(params.itemId ?? '', context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/items/:itemId/thread',
    handler: (request, { params }) => launchAzureItemTask(request, params.itemId ?? '', context),
  })
}

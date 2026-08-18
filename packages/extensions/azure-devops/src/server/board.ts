import { Effect } from 'effect'
import type { WorkManagementProvider } from '@vertexade/platform-contracts'
import { runApiEffect } from '@vertexade/platform-server/effect'
import {
  AZURE_BACKLOG_WORK_ITEM_TYPES,
  AZURE_BOARD_WORK_ITEM_TYPES,
  azureBoardWorkItemTypes,
  AzureDevOpsClient,
  isAzureBacklogWorkItemType,
  type AzureConfig,
} from './client.ts'
import { azureRequestEffect } from './effect.ts'

type AzureProvider = WorkManagementProvider<AzureConfig, AzureDevOpsClient>
type AzureTeam = { name: string }

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function firstText(...values: unknown[]) {
  return values.map(text).find(Boolean) ?? ''
}

function selectedIterationPath(iterations: any[], requested: string) {
  if (requested) return requested
  const duration = (iteration: any) => {
    const start = new Date(String(iteration.start_date || '')).getTime()
    const finish = new Date(String(iteration.finish_date || '')).getTime()
    return Number.isFinite(start) && Number.isFinite(finish) ? finish - start : Number.MAX_SAFE_INTEGER
  }
  const current = iterations
    .filter((item) => item.timeframe === 'current')
    .sort(
      (left, right) =>
        duration(left) - duration(right) ||
        right.path.split('\\').length - left.path.split('\\').length ||
        String(right.start_date || '').localeCompare(String(left.start_date || '')),
    )
  return current[0]?.path || iterations[0]?.path || ''
}

async function loadIterationItems(client: any, path: string, workItemTypes: readonly string[], signal?: AbortSignal) {
  return path ? client.sprintItems(path, signal, workItemTypes) : []
}

export async function selectAzureIterationItems(
  client: any,
  iterations: any[],
  requestedPath: string,
  signal?: AbortSignal,
  workItemTypes: readonly string[] = AZURE_BOARD_WORK_ITEM_TYPES,
) {
  const selectedPath = selectedIterationPath(iterations, requestedPath)
  const items = await loadIterationItems(client, selectedPath, workItemTypes, signal)
  if (items.length) return { selectedPath, items, loadedPath: selectedPath }

  const selectedIteration = iterations.find((iteration) => iteration.path === selectedPath)
  if (selectedIteration?.timeframe !== 'current') return { selectedPath, items, loadedPath: selectedPath }
  const activeAncestors = iterations
    .filter(
      (iteration) => iteration.path !== selectedPath && iteration.timeframe === 'current' && selectedPath.startsWith(`${iteration.path}\\`),
    )
    .sort((left, right) => right.path.split('\\').length - left.path.split('\\').length)
  for (const iteration of activeAncestors) {
    const fallbackItems = await loadIterationItems(client, iteration.path, workItemTypes, signal)
    if (fallbackItems.length) return { selectedPath, items: fallbackItems, loadedPath: iteration.path }
  }
  return { selectedPath, items, loadedPath: selectedPath }
}

async function loadTaskboard(client: any, selectedIteration: any, selectedPath: string) {
  if (!selectedIteration?.id) return { columns: [], items: [], team: null, iterationId: selectedIteration?.id, error: null }
  try {
    const teams = await runApiEffect(azureRequestEffect<AzureTeam[]>('teams', (signal) => client.teams(signal)))
    const teamIterations = await runApiEffect(
      Effect.forEach(
        teams,
        (team) =>
          azureRequestEffect('team-iterations', async (signal) => ({
            team,
            iterations: await client.teamIterations(team.name, signal),
          })),
        { concurrency: 'unbounded' },
      ),
    )
    const match = teamIterations.find(({ iterations }) => iterations.some((iteration: any) => iteration.path === selectedPath))
    const team = match?.team.name || null
    const iterationId = match?.iterations.find((iteration: any) => iteration.path === selectedPath)?.id || selectedIteration.id
    const [columns, items] = team
      ? await runApiEffect(
          Effect.all(
            [
              azureRequestEffect('taskboard-columns', (signal) => client.taskboardColumns(team, signal)),
              azureRequestEffect('taskboard-items', (signal) => client.taskboardItems(team, iterationId, signal)),
            ],
            {
              concurrency: 'unbounded',
            },
          ),
        )
      : [[], []]
    return { columns, items, team, iterationId, error: null }
  } catch (error) {
    return {
      columns: [],
      items: [],
      team: null,
      iterationId: selectedIteration.id,
      error: (error as Error).message,
    }
  }
}

function decorateBoardItems(items: any[], taskboardItems: any[]) {
  const columns = new Map(taskboardItems.map((item) => [Number(item.workItemId), item.column]))
  for (const item of items) item.board_column = columns.get(item.id) || item.state
}

type AzureTaskboardContext = {
  columns: any[]
  team: string | null
  iterationId: string | null
}

function moveColumnAction(item: any, taskboard: AzureTaskboardContext) {
  if (!taskboard.team || !taskboard.iterationId || !taskboard.columns.length) {
    return null
  }
  return {
    id: 'move-board-column',
    label: 'Move column',
    description: 'Move this item to another Azure taskboard column.',
    method: 'PATCH',
    path: `/items/${item.id}/column`,
    inputs: [
      {
        name: 'iteration_id',
        label: 'Iteration',
        type: 'hidden',
        required: true,
        defaultValue: taskboard.iterationId,
      },
      { name: 'team', label: 'Team', type: 'hidden', required: true, defaultValue: taskboard.team },
      {
        name: 'column',
        label: 'Board column',
        type: 'select',
        required: true,
        defaultValue: String(item.board_column || ''),
        options: taskboard.columns.map((column) => ({
          value: String(column.name),
          label: String(column.name),
        })),
      },
    ],
    successMessage: 'Azure taskboard column updated.',
  }
}

function prepareSubtasksAction(item: any) {
  if (!isAzureBacklogWorkItemType(item.type)) return null
  return {
    id: 'prepare-subtasks',
    label: 'Prepare subtasks',
    description: 'Use an agent to propose implementation subtasks for this story.',
    method: 'POST',
    path: `/items/${item.id}/prepare-subtasks`,
    inputs: [
      { name: 'prompt', label: 'Planning request', type: 'textarea', required: true },
      {
        name: 'repository_ids',
        label: 'Repository context',
        type: 'multiselect',
        optionsPath: 'repositories',
        optionValuePath: 'id',
        optionLabelPath: 'full_name',
      },
    ],
    job: {
      idPath: 'id',
      statusPath: '/prepare/{jobId}',
      statusValuePath: 'job.status',
      resultPath: 'drafts',
      errorPath: 'error',
      completedValues: ['completed'],
      failedValues: ['failed', 'cancelled'],
      resultBodyPath: ['stories'],
      refineAction: {
        id: 'refine-subtasks',
        label: 'Refine subtasks',
        method: 'POST',
        path: '/prepare/{jobId}/refine',
        inputs: [{ name: 'prompt', label: 'Refinement', type: 'textarea', required: true }],
      },
      completeAction: {
        id: 'create-subtasks',
        label: 'Create subtasks',
        method: 'POST',
        path: `/items/${item.id}/subtasks`,
        successMessage: 'Azure subtasks created.',
      },
    },
    successMessage: 'Subtask planning started.',
  }
}

function portableAzureActions(item: any, taskboard: AzureTaskboardContext) {
  return [moveColumnAction(item, taskboard), prepareSubtasksAction(item)].filter(Boolean)
}

function portableAzureFields(item: any) {
  const assignee = firstText(item.assigned_to?.display_name, item.assigned_to?.unique_name, 'Unassigned')
  const tags = Array.isArray(item.tags) ? item.tags.join(', ') : text(item.tags)
  const itemUrl = text(item.url)
  return [
    { name: 'Type', value: text(item.type), style: 'badge', placement: 'card' },
    { name: 'State', value: text(item.state), style: 'badge', placement: 'card' },
    {
      name: 'Board column',
      value: firstText(item.board_column, item.state),
      style: 'badge',
      placement: 'card',
    },
    {
      name: 'Assigned',
      value: String(assignee),
      style: 'person',
      placement: 'card',
      image_url: item.assigned_to?.image_url
        ? `/api/extensions/azure-devops/avatar?url=${encodeURIComponent(String(item.assigned_to.image_url))}`
        : '',
    },
    { name: 'Iteration', value: text(item.iteration_path), style: 'text', placement: 'detail' },
    { name: 'Area', value: text(item.area_path), style: 'text', placement: 'detail' },
    { name: 'Tags', value: tags, style: 'text', placement: 'detail' },
    {
      name: 'Evidence',
      value: itemUrl,
      style: 'links',
      placement: 'detail',
      relation: {
        items: itemUrl ? [{ id: String(item.id), title: 'Open in Azure Boards', url: itemUrl }] : [],
      },
    },
  ]
}

export function portableAzureItem(item: any, statesByType: Record<string, string[]>, context: { taskboard: AzureTaskboardContext }) {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    state: item.state,
    board_column: item.board_column,
    assigned_to: item.assigned_to,
    iteration_path: item.iteration_path,
    area_path: item.area_path,
    tags: item.tags,
    parent_id: item.parent_id,
    url: item.url,
    portable_actions: portableAzureActions(item, context.taskboard),
    portable_title: `${item.type || 'Work item'} #${item.id}: ${item.title}`,
    state_options: (statesByType[item.type] || []).map((state) => ({ id: state, name: state })),
    portable_fields: portableAzureFields(item),
  }
}

function boardFacets(items: any[], features: any[]) {
  const assignees = [
    ...new Map(
      [...items, ...features].flatMap((item) => (item.assigned_to ? [[item.assigned_to.unique_name, item.assigned_to]] : [])),
    ).values(),
  ]
  const areas = [...new Set<string>([...items, ...features].map((item) => item.area_path).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  )
  return { assignees, areas }
}

export function portableAzureDetail(item: any, children: any[]) {
  const activity = [
    item.changed_at && {
      title: 'Work item updated',
      detail: item.changed_by || 'Azure DevOps',
      at: item.changed_at,
    },
    item.created_at && {
      title: 'Work item created',
      detail: item.created_by || 'Azure DevOps',
      at: item.created_at,
    },
  ].filter(Boolean)
  return {
    ...item,
    children: children.map((child) => ({
      id: child.id,
      title: child.title,
      type: child.type,
      state: child.state,
      assigned_to: child.assigned_to,
      story_points: child.story_points,
      effort: child.effort,
    })),
    portable_activity: activity,
  }
}

function storyType(types: string[]) {
  return AZURE_BACKLOG_WORK_ITEM_TYPES.find((type) => types.includes(type)) ?? AZURE_BACKLOG_WORK_ITEM_TYPES[0]
}

export function azurePortableGroupOrder(statesByType: Record<string, string[]>, preferredStoryType: string, taskboardColumns: any[] = []) {
  const typeOrder = [preferredStoryType, 'Task']
  const stateTypeOrder = [...new Set([...typeOrder, ...Object.keys(statesByType)])]
  const stateOrder = [...new Set(stateTypeOrder.flatMap((type) => statesByType[type] || []))]
  const boardOrder = taskboardColumns.length
    ? taskboardColumns
        .map((column) => ({ name: String(column.name || ''), order: Number(column.order || 0) }))
        .sort((left, right) => left.order - right.order)
        .map((column) => column.name)
        .filter(Boolean)
    : stateOrder
  return [
    ...typeOrder.map((value) => ({ field: 'Type', value })),
    ...stateOrder.map((value) => ({ field: 'State', value })),
    ...boardOrder.map((value) => ({ field: 'Board column', value })),
  ]
}

export async function loadAzureBoardData(provider: AzureProvider, config: AzureConfig, iterationPath: string) {
  const client = provider.createClient(config)
  const [iterations, types] = await runApiEffect(
    Effect.all(
      [
        azureRequestEffect('iterations', (signal) => client.iterations(signal)),
        azureRequestEffect('work-item-types', (signal) => client.workItemTypes(signal)),
      ],
      { concurrency: 'unbounded' },
    ),
  )
  const supportedTypes = azureBoardWorkItemTypes(types)
  const [features, stateEntries, iteration] = await runApiEffect(
    Effect.all(
      [
        azureRequestEffect('features', (signal) => client.features(signal, types)),
        Effect.forEach(
          supportedTypes,
          (type) => azureRequestEffect('work-item-states', async (signal) => [type, await client.workItemStates(type, signal)] as const),
          { concurrency: 'unbounded' },
        ),
        azureRequestEffect('iteration-items', (signal) =>
          selectAzureIterationItems(client, iterations, iterationPath, signal, supportedTypes),
        ),
      ],
      { concurrency: 'unbounded' },
    ),
  )
  const statesByType = Object.fromEntries(stateEntries)
  const { selectedPath, items, loadedPath } = iteration
  const selectedIteration = iterations.find((item: any) => item.path === selectedPath)
  const taskboard = await loadTaskboard(client, selectedIteration, selectedPath)
  decorateBoardItems(items, taskboard.items)
  const preferredStoryType = storyType(types)
  const parents = [
    ...features.map((feature: any) => ({
      id: String(feature.id),
      name: `Feature #${feature.id}: ${feature.title}`,
      allowed_type: preferredStoryType,
    })),
    ...items
      .filter((item: any) => isAzureBacklogWorkItemType(item.type))
      .map((item: any) => ({
        id: String(item.id),
        name: `${item.type} #${item.id}: ${item.title}`,
        allowed_type: 'Task',
      })),
  ]
  return {
    configured: true,
    project: config.project,
    iterations,
    selected_iteration: selectedPath,
    loaded_iteration: loadedPath,
    features,
    items,
    portable_items: items.map((item: any) => portableAzureItem(item, statesByType, { taskboard })),
    portable_group_fields: [{ field: 'Type' }, { field: 'State' }, { field: 'Board column' }, { field: 'Assigned' }],
    ...boardFacets(items, features),
    story_type: preferredStoryType,
    states_by_type: statesByType,
    portable_group_order: azurePortableGroupOrder(statesByType, preferredStoryType, taskboard.columns),
    taskboard_columns: taskboard.columns
      .map(({ id, name, order }: any) => ({ id, name, order }))
      .sort((left: any, right: any) => left.order - right.order),
    selected_iteration_id: taskboard.iterationId,
    selected_team: taskboard.team,
    taskboard_error: taskboard.error,
    portable_parents: parents,
    portable_collection_actions: [
      {
        id: 'create-item',
        label: 'New work item',
        description: 'Create a story or task in the selected Azure sprint.',
        method: 'POST',
        path: '/items',
        inputs: [
          {
            name: 'type',
            label: 'Type',
            type: 'select',
            required: true,
            defaultValue: preferredStoryType,
            options: [preferredStoryType, 'Task'].map((value) => ({ value, label: value })),
          },
          { name: 'title', label: 'Title', type: 'text', required: true },
          { name: 'description', label: 'Description', type: 'textarea' },
          {
            name: 'iteration_path',
            label: 'Sprint',
            type: 'hidden',
            required: true,
            defaultSource: 'surface',
            defaultPath: 'selected_iteration',
          },
          {
            name: 'parent_id',
            label: 'Parent feature or story (required for tasks)',
            type: 'select',
            optionsPath: 'portable_parents',
            optionValuePath: 'id',
            optionLabelPath: 'name',
            optionsFilterInput: 'type',
            optionsFilterPath: 'allowed_type',
          },
          { name: 'assigned_to', label: 'Assigned to', type: 'text' },
          { name: 'area_path', label: 'Area path', type: 'text' },
          { name: 'tags', label: 'Tags (comma separated)', type: 'text' },
        ],
        successMessage: 'Azure work item created.',
      },
      {
        id: 'prepare-plan',
        label: 'Prepare with Codex',
        description: 'Prepare a reviewable story and subtask plan for the selected sprint.',
        method: 'POST',
        path: '/prepare',
        inputs: [
          { name: 'prompt', label: 'What should be planned?', type: 'textarea', required: true },
          {
            name: 'repository_ids',
            label: 'Repository context',
            type: 'multiselect',
            optionsPath: 'repositories',
            optionValuePath: 'id',
            optionLabelPath: 'full_name',
          },
          {
            name: 'iteration_path',
            label: 'Sprint',
            type: 'hidden',
            required: true,
            defaultSource: 'surface',
            defaultPath: 'selected_iteration',
          },
        ],
        job: {
          idPath: 'id',
          statusPath: '/prepare/{jobId}',
          statusValuePath: 'job.status',
          resultPath: 'drafts',
          errorPath: 'error',
          completedValues: ['completed'],
          failedValues: ['failed', 'cancelled'],
          resultBodyPath: ['stories'],
          refineAction: {
            id: 'refine-plan',
            label: 'Refine plan',
            method: 'POST',
            path: '/prepare/{jobId}/refine',
            inputs: [{ name: 'prompt', label: 'Refinement', type: 'textarea', required: true }],
          },
          completeAction: {
            id: 'create-drafts',
            label: 'Create selected stories',
            method: 'POST',
            path: '/drafts',
            inputs: [
              {
                name: 'iteration_path',
                label: 'Sprint',
                type: 'hidden',
                required: true,
                defaultSource: 'surface',
                defaultPath: 'selected_iteration',
              },
              {
                name: 'story_type',
                label: 'Story type',
                type: 'hidden',
                required: true,
                defaultSource: 'surface',
                defaultPath: 'story_type',
              },
            ],
            successMessage: 'Azure stories and subtasks created.',
          },
        },
        successMessage: 'Azure planning started.',
      },
    ],
  }
}

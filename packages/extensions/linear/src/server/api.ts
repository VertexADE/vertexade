import type { ExtensionHostServices, ExtensionRegistrationContext, WorkManagementProvider } from '@vertexade/platform-contracts'
import { loadExtensionData, publishExtensionChange } from '@vertexade/platform-server/extension-data'
import { readJsonObject } from '@vertexade/platform-server/http'
import { agentSafetyBoundary } from '@vertexade/platform-server/prompts'
import { extensionWebhookDependencies } from '@vertexade/platform-server/webhooks'
import { normalizeLinearConfig, type LinearClient, type LinearConfig, type LinearIssueInput } from './client.ts'
import type { CacheRefreshTrigger } from '@vertexade/platform-server/cache-trigger'
import { handleLinearWebhook } from './webhook.ts'

function configFor(provider: WorkManagementProvider<LinearConfig, LinearClient>, host: ExtensionHostServices) {
  return provider.normalizeConfig(host.settings.read('config', { apiKey: '', teamIds: [], webhookSecret: '' }))
}

function publicConfig(config: LinearConfig, host: ExtensionHostServices) {
  return {
    configured: Boolean(config.apiKey && config.teamIds.length),
    has_api_key: Boolean(config.apiKey),
    has_webhook_secret: Boolean(config.webhookSecret),
    team_ids: config.teamIds,
    webhook_path: '/api/extensions/linear/webhook',
    repositories: host.repositories.list(),
  }
}

function cleanIssueInput(input: Record<string, unknown>): LinearIssueInput {
  const text = (key: string) => (Object.hasOwn(input, key) ? String(input[key] || '').trim() : undefined)
  const nullable = (key: string) => {
    const value = text(key)
    return value === undefined ? undefined : value || null
  }
  return Object.fromEntries(
    [
      ['title', text('title')],
      ['description', text('description')],
      ['teamId', text('team_id')],
      ['stateId', nullable('state_id')],
      ['projectId', nullable('project_id')],
      ['priority', Object.hasOwn(input, 'priority') ? Number(input.priority) : undefined],
    ].filter((entry) => entry[1] !== undefined),
  ) as LinearIssueInput
}

function validateTitle(title: string | undefined, required: boolean) {
  if (title === undefined) return validateMissingTitle(required)
  validateTitleValue(title)
}

function validateMissingTitle(required: boolean) {
  if (required) throw new Error('Title is required')
}

function validateTitleValue(title: string) {
  if (!title) throw new Error('Title must contain 1–255 characters')
  if (title.length > 255) throw new Error('Title must contain 1–255 characters')
}

function validateTeam(input: LinearIssueInput, creating: boolean) {
  if (!creating) return
  if (!input.teamId) throw new Error('Choose a Linear team')
}

function validateDescription(description: string | undefined) {
  if (description === undefined) return
  if (description.length > 20_000) throw new Error('Description must contain at most 20,000 characters')
}

function validatePriority(priority: number | undefined) {
  if (priority === undefined) return
  if (!Number.isInteger(priority)) throw new Error('Priority must be 0–4')
  if (!new Set([0, 1, 2, 3, 4]).has(priority)) throw new Error('Priority must be 0–4')
}

function validateIssueInput(input: LinearIssueInput, creating = false) {
  validateTeam(input, creating)
  validateTitle(input.title, creating)
  validateDescription(input.description)
  validatePriority(input.priority)
}

type LinearApiContext = {
  provider: WorkManagementProvider<LinearConfig, LinearClient>
  host: ExtensionHostServices
  settings(): LinearConfig
  client(): LinearClient
  refreshTrigger: CacheRefreshTrigger
}

export async function cachedLinearOverview(
  client: LinearClient,
  host: ExtensionHostServices,
  refreshTrigger: CacheRefreshTrigger,
  forceRefresh = false,
) {
  const loader = async () => {
    const value = await client.overview()
    refreshTrigger.emitRefresh({
      force: forceRefresh,
      provider: 'linear',
      key: 'board:overview',
      subject: 'linear:board',
      data: { count: value.issues.length },
    })
    return value
  }
  return loadExtensionData(host, 'board:overview', loader, forceRefresh)
}

function errorResponse(error: unknown, status = 400) {
  return Response.json({ error: (error as Error).message }, { status })
}

function configured(config: LinearConfig) {
  if (!config.apiKey) return false
  return config.teamIds.length > 0
}

const priorityLabels = ['No priority', 'Urgent', 'High', 'Normal', 'Low']

function linearText(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function linearPriority(issue: Record<string, any>) {
  return priorityLabels[Number(issue.priority)] ?? `Priority ${issue.priority}`
}

function portableLinearIssue(issue: Record<string, any>, states: Record<string, any>[]) {
  const stateOptions = states
    .filter((state) => String(state.team?.id) === String(issue.team?.id))
    .map((state) => ({
      id: String(state.id),
      name: linearText(state.name) || String(state.id),
    }))
  const issueUrl = linearText(issue.url)
  return {
    ...issue,
    portable_title: `${issue.identifier}: ${issue.title}`,
    state_options: stateOptions,
    portable_fields: [
      { name: 'State', value: linearText(issue.state?.name), style: 'badge', placement: 'card' },
      { name: 'Priority', value: linearPriority(issue), style: 'badge', placement: 'card' },
      { name: 'Team', value: linearText(issue.team?.name), style: 'text', placement: 'card' },
      { name: 'Project', value: linearText(issue.project?.name), style: 'text', placement: 'card' },
      {
        name: 'Assignee',
        value: linearText(issue.assignee?.name) || 'Unassigned',
        style: 'person',
        placement: 'detail',
      },
      { name: 'Updated', value: linearText(issue.updatedAt), style: 'date', placement: 'detail' },
      {
        name: 'Description',
        value: linearText(issue.description),
        style: 'text',
        placement: 'detail',
      },
      {
        name: 'Evidence',
        value: issueUrl,
        style: 'links',
        placement: 'detail',
        relation: {
          items: issueUrl ? [{ id: String(issue.id), title: 'Open in Linear', url: issueUrl }] : [],
        },
      },
    ],
  }
}

function requireConfigured(config: LinearConfig) {
  if (!config.apiKey) throw new Error('Enter an API key and select at least one team')
  if (!config.teamIds.length) throw new Error('Enter an API key and select at least one team')
}

async function verifyTeams(context: LinearApiContext, config: LinearConfig) {
  const available = await context.provider.createClient(config).teams()
  const allowed = new Set(available.teams.map((team) => String(team.id)))
  const unavailable = config.teamIds.filter((id) => !allowed.has(id))
  if (unavailable.length) throw new Error('One or more selected Linear teams are unavailable to this API key')
}

async function discover(request: Request, context: LinearApiContext) {
  const config = normalizeLinearConfig(await readJsonObject(request), context.settings())
  if (!config.apiKey) return Response.json({ error: 'Enter a Linear personal API key' }, { status: 400 })
  try {
    return Response.json(await context.provider.createClient(config).teams())
  } catch (error) {
    return errorResponse(error)
  }
}

async function saveSettings(request: Request, context: LinearApiContext) {
  try {
    const config = normalizeLinearConfig(await readJsonObject(request), context.settings())
    requireConfigured(config)
    await verifyTeams(context, config)
    context.host.settings.write('config', config)
    publishExtensionChange(context.host, 'linear_settings_updated')
    return Response.json(publicConfig(config, context.host))
  } catch (error) {
    return errorResponse(error)
  }
}

async function board(request: Request, context: LinearApiContext) {
  try {
    const result = await cachedLinearOverview(
      context.client(),
      context.host,
      context.refreshTrigger,
      new URL(request.url).searchParams.get('force_refresh') === '1',
    )
    return Response.json({
      configured: true,
      ...result.value,
      issues: result.value.issues.map((issue) => portableLinearIssue(issue, result.value.states)),
      portable_projects: result.value.projects.flatMap((project) =>
        (project.teams?.nodes || []).map((team: Record<string, unknown>) => ({
          id: String(project.id),
          name: String(project.name || project.id),
          team_id: String(team.id || ''),
        })),
      ),
      repositories: context.host.repositories.list(),
      portable_group_fields: [{ field: 'State' }, { field: 'Team' }, { field: 'Project' }, { field: 'Priority' }],
      ...(result.cache ? { cache: result.cache } : {}),
    })
  } catch (error) {
    if (!configured(context.settings()))
      return Response.json({
        configured: false,
        teams: [],
        projects: [],
        states: [],
        issues: [],
        repositories: context.host.repositories.list(),
      })
    return errorResponse(error, 502)
  }
}

async function createIssue(request: Request, context: LinearApiContext) {
  try {
    const input = cleanIssueInput(await readJsonObject(request))
    validateIssueInput(input, true)
    if (!context.settings().teamIds.includes(String(input.teamId))) throw new Error('Choose one of the configured Linear teams')
    const issue = await context.client().createIssue(input as Required<Pick<LinearIssueInput, 'title' | 'teamId'>> & LinearIssueInput)
    publishExtensionChange(context.host, 'linear_issue_created')
    return Response.json(issue, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

function rejectTeamMove(input: LinearIssueInput, existing: Record<string, any>) {
  if (input.teamId && input.teamId !== existing.team?.id) throw new Error('Moving issues between teams is not supported here')
}

function requireUpdate(input: LinearIssueInput) {
  if (!Object.keys(input).length) throw new Error('Include at least one issue field to update')
}

function checkedUpdate(input: LinearIssueInput, existing: Record<string, any>) {
  validateIssueInput(input)
  rejectTeamMove(input, existing)
  delete input.teamId
  requireUpdate(input)
  return input
}

async function updateIssue(request: Request, issueId: string, context: LinearApiContext) {
  try {
    const existing = await context.client().issue(issueId)
    const input = checkedUpdate(cleanIssueInput(await readJsonObject(request)), existing)
    const issue = await context.client().updateIssue(issueId, input)
    publishExtensionChange(context.host, 'linear_issue_updated')
    return Response.json(issue)
  } catch (error) {
    return errorResponse(error)
  }
}

function launchPrompt(issue: Record<string, any>, repository: string, instruction: unknown) {
  const payload = {
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    state: issue.state?.name,
    project: issue.project?.name,
    priority: issue.priority,
    url: issue.url,
  }
  return `${agentSafetyBoundary()}\n\nImplement the following Linear issue in ${repository}. First reconstruct the intended user outcome, observable success criteria, constraints, and non-goals from the issue and repository evidence. If material ambiguity remains, record it clearly before making a risky assumption.\n\n<untrusted_external_payload>\n${JSON.stringify(payload, null, 2)}\n</untrusted_external_payload>\n\n${String(instruction ?? '').trim()}`
}

function selectedRepository(input: Record<string, unknown>, context: LinearApiContext) {
  const repository = context.host.repositories.get(Number(input.repository_id))
  if (!repository) throw new Error('Choose a repository')
  return repository
}

function sourceReference(issue: Record<string, any>) {
  return {
    provider: 'linear',
    kind: 'issue',
    externalId: String(issue.id),
    role: 'source' as const,
    label: `${issue.identifier}: ${issue.title}`,
    url: issue.url,
    state: issue.state?.name,
    primary: true,
    metadata: {
      identifier: issue.identifier,
      team: issue.team?.name,
      project: issue.project?.name,
    },
  }
}

async function launchIssueTask(input: Record<string, unknown>, issue: Record<string, any>, context: LinearApiContext) {
  const repository = selectedRepository(input, context)
  return context.host.tasks.launch(
    repository,
    `${issue.identifier}: ${issue.title}`.slice(0, 100),
    launchPrompt(issue, repository.full_name, input.instruction),
    input.create_pr !== false,
    'feature',
    {
      source: sourceReference(issue),
      workspaceMode: 'combined',
    },
  )
}

async function launchIssue(request: Request, issueId: string, context: LinearApiContext) {
  try {
    const input = await readJsonObject(request)
    const issue = await context.client().issue(issueId)
    const job = await launchIssueTask(input, issue, context)
    return Response.json(job, { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
}

export function registerLinearApi(
  registration: ExtensionRegistrationContext,
  provider: WorkManagementProvider<LinearConfig, LinearClient>,
  host: ExtensionHostServices,
  refreshTrigger: CacheRefreshTrigger,
) {
  const settings = () => configFor(provider, host)
  const client = () => {
    const config = settings()
    if (!config.apiKey || !config.teamIds.length) throw new Error('Configure Linear and select at least one team first')
    return provider.createClient(config)
  }
  const context = { provider, host, settings, client, refreshTrigger }

  registration.routes.register({
    method: 'GET',
    path: '/settings',
    availability: 'installed',
    handler: () => Response.json(publicConfig(settings(), host)),
  })
  registration.routes.register({
    method: 'POST',
    path: '/discover',
    availability: 'installed',
    handler: (request) => discover(request, context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/settings',
    availability: 'installed',
    handler: (request) => saveSettings(request, context),
  })
  registration.routes.register({
    method: 'DELETE',
    path: '/settings',
    availability: 'installed',
    handler: () => {
      host.settings.delete('config')
      publishExtensionChange(host, 'linear_settings_deleted')
      return Response.json(publicConfig({ apiKey: '', teamIds: [], webhookSecret: '' }, host))
    },
  })
  registration.routes.register({
    method: 'POST',
    path: '/webhook',
    handler: (request) => handleLinearWebhook(request, extensionWebhookDependencies(host, settings)),
  })
  registration.routes.register({
    method: 'GET',
    path: '/board',
    handler: (request) => board(request, context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/issues',
    handler: (request) => createIssue(request, context),
  })
  registration.routes.register({
    method: 'PATCH',
    path: '/issues/:issueId',
    handler: (request, { params }) => updateIssue(request, String(params.issueId ?? ''), context),
  })
  registration.routes.register({
    method: 'POST',
    path: '/issues/:issueId/thread',
    handler: (request, { params }) => launchIssue(request, String(params.issueId ?? ''), context),
  })
}

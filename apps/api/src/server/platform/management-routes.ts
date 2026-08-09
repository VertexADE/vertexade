import { PLATFORM_API_VERSION, PLATFORM_FEATURES } from '@vertexade/platform-contracts'
import { HttpError, readJsonObject } from '@vertexade/platform-server/http'
import { HttpRouter } from '@vertexade/platform-server/router'
import type { AgentRegistry } from '../agents/registry.ts'
import type { ExtensionRegistry } from '../extensions/registry.ts'
import type { SettingsStore } from '../settings/settings-store.ts'
import type { ExtensionCacheStore } from '../extensions/cache.ts'
import { registeredProviders } from './provider-selection.ts'

export type ContentGenerationDefaults = {
  agentId: string
  model: string
  reasoningEffort: string
  serviceTier: string
  permissionMode: 'read-only'
}

type WorkItemTitleInput = {
  context: string
  kind: string
}

type Dependencies = {
  extensions: ExtensionRegistry
  agents: AgentRegistry
  encryptedSettings: SettingsStore
  cache?: ExtensionCacheStore
  defaultAgentId(): string
  extensionEnabled(id: string): boolean
  decorateExtension?<T extends { id: string; enabled: boolean }>(extension: T): T
  toggleExtension?(
    id: string,
    enabled: boolean,
  ): Promise<{
    ok: boolean
    id: string
    desiredEnabled: boolean
    appliedEnabled: boolean
    pending: boolean
    error: string | null
    warning?: string
  }>
  notify(reason: string, id?: number | null): void
  generateWorkItemTitle?(input: WorkItemTitleInput, defaults: ContentGenerationDefaults): Promise<string>
}

const contentGenerationSettingsKey = 'content_generation'

function text(value: unknown, maximum = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function contentGenerationDefaults(
  dependencies: Pick<Dependencies, 'encryptedSettings' | 'agents' | 'defaultAgentId'>,
): ContentGenerationDefaults {
  const stored = dependencies.encryptedSettings.read<Record<string, unknown>>(contentGenerationSettingsKey, {})
  const requestedAgentId = text(stored.agentId)
  const requestedAgent = dependencies.agents.capabilities().find(({ id }) => id === requestedAgentId)
  const defaultAgent = dependencies.agents.capabilities().find(({ id }) => id === dependencies.defaultAgentId())
  const fallbackAgent =
    defaultAgent?.enabled && defaultAgent.supportsReadOnlyMode
      ? defaultAgent
      : dependencies.agents.capabilities().find((agent) => agent.enabled && agent.supportsReadOnlyMode && !agent.preset)
  const agentId =
    requestedAgent?.enabled && requestedAgent.supportsReadOnlyMode && !requestedAgent.preset ? requestedAgentId : fallbackAgent?.id || ''
  return {
    agentId,
    model: text(stored.model),
    reasoningEffort: text(stored.reasoningEffort),
    serviceTier: agentId === 'codex' && stored.serviceTier === 'priority' ? 'priority' : '',
    permissionMode: 'read-only',
  }
}

function agentModels(value: Record<string, unknown>) {
  return Array.isArray(value.models)
    ? value.models.filter((model): model is Record<string, unknown> => Boolean(model && typeof model === 'object'))
    : []
}

async function saveContentGenerationDefaults(request: Request, dependencies: Dependencies) {
  const input = await readJsonObject(request)
  for (const key of Object.keys(input)) {
    if (!['agentId', 'model', 'reasoningEffort', 'serviceTier'].includes(key))
      throw new HttpError(`Unknown content generation setting: ${key}`, 400)
  }
  const agentId = text(input.agentId)
  if (!agentId) throw new HttpError('Choose an agent provider', 400)
  const capability = dependencies.agents.capabilities().find(({ id }) => id === agentId)
  const agent = dependencies.agents.get(agentId)
  if (!capability?.enabled || !agent) throw new HttpError('Choose an enabled agent provider', 400)
  if (!capability.supportsReadOnlyMode) throw new HttpError(`${agent.name} does not support read-only generation`, 400)
  if (agent.preset) throw new HttpError('Choose a provider instead of a custom agent', 400)

  const model = text(input.model)
  const reasoningEffort = text(input.reasoningEffort)
  const serviceTier = agentId === 'codex' && input.serviceTier === 'priority' ? 'priority' : ''
  const launchOptions = agent.launchOptions ? await agent.launchOptions({ environment: agent.environment?.() || {} }) : {}
  const models = agentModels(launchOptions)
  const selectedModel = models.find((candidate) => candidate.id === model)
  if (model && models.length && !selectedModel) throw new HttpError(`Model is not available for ${agent.name}`, 400)
  const efforts = Array.isArray(selectedModel?.reasoning_efforts)
    ? selectedModel.reasoning_efforts.filter((effort): effort is Record<string, unknown> => Boolean(effort && typeof effort === 'object'))
    : []
  if (reasoningEffort && efforts.length && !efforts.some((effort) => effort.id === reasoningEffort)) {
    throw new HttpError(`Reasoning level is not available for ${model}`, 400)
  }

  dependencies.encryptedSettings.write(contentGenerationSettingsKey, {
    agentId,
    model,
    reasoningEffort,
    serviceTier,
  })
  dependencies.notify('content_generation_settings_updated')
  return Response.json(contentGenerationDefaults(dependencies))
}

async function generateWorkItemTitle(request: Request, dependencies: Dependencies) {
  if (!dependencies.generateWorkItemTitle) throw new HttpError('Work item title generation is unavailable', 503)
  const input = await readJsonObject(request)
  for (const key of Object.keys(input)) {
    if (!['context', 'kind'].includes(key)) throw new HttpError(`Unknown work item title input: ${key}`, 400)
  }
  const context = typeof input.context === 'string' ? input.context.trim() : ''
  if (!context) throw new HttpError('Add context before generating a title', 400)
  if (context.length > 20_000) throw new HttpError('Work item title context exceeds 20,000 characters', 400)
  const kind = text(input.kind, 40) || 'implementation'
  try {
    return Response.json({
      title: await dependencies.generateWorkItemTitle({ context, kind }, contentGenerationDefaults(dependencies)),
      defaults: contentGenerationDefaults(dependencies),
    })
  } catch (error) {
    throw new HttpError(error instanceof Error ? error.message : 'Could not generate a Work item title', 502)
  }
}

export function createPlatformManagementRoutes(dependencies: Dependencies) {
  const router = new HttpRouter()
  const catalog = () =>
    dependencies.extensions
      .catalog()
      .map((extension) => (dependencies.decorateExtension ? dependencies.decorateExtension(extension) : extension))

  router.get('/api/modules', () =>
    Response.json({
      platformApi: PLATFORM_API_VERSION,
      platformFeatures: PLATFORM_FEATURES,
      modules: catalog(),
      diagnostics: dependencies.extensions.diagnostics(),
      ...(dependencies.cache ? { cache: dependencies.cache.allStats() } : {}),
    }),
  )

  router.delete('/api/modules/:moduleId/cache', (_request, { params }) => {
    const moduleId = String(params.moduleId || '')
    if (!dependencies.extensions.installed(moduleId)) throw new HttpError('Extension is not installed', 404)
    if (!dependencies.cache) throw new HttpError('Extension cache is unavailable', 503)
    const removed = dependencies.cache.invalidateNamespace(moduleId)
    dependencies.notify('extension_cache_invalidated')
    return Response.json({ moduleId, removed, stats: dependencies.cache.statsFor(moduleId) })
  })

  router.get('/api/ai/models', async () => {
    const agent = dependencies.agents.require(dependencies.defaultAgentId())
    return Response.json(agent.launchOptions ? await agent.launchOptions({ environment: agent.environment?.() || {} }) : { models: [] })
  })

  router.get('/api/agent/options', async (request) => {
    const requestedId = new URL(request.url).searchParams.get('agent') || dependencies.defaultAgentId()
    const agent = dependencies.agents.require(requestedId)
    return Response.json({
      agent: { id: agent.id, name: agent.name, ...(agent.preset ? { preset: agent.preset } : {}) },
      agents: dependencies.agents.capabilities(),
      ...(agent.launchOptions ? await agent.launchOptions({ environment: agent.environment?.() || {} }) : {}),
    })
  })

  router.get('/api/settings/content-generation', () => Response.json(contentGenerationDefaults(dependencies)))
  router.post('/api/settings/content-generation', (request) => saveContentGenerationDefaults(request, dependencies))
  router.post('/api/content-generation/work-item-title', (request) => generateWorkItemTitle(request, dependencies))

  router.get('/api/capabilities', () => {
    const providers = dependencies.extensions.providers.capabilities()
    const registrations = registeredProviders(providers)
    const defaultAgentId = dependencies.defaultAgentId()
    return Response.json({
      agent_provider: defaultAgentId,
      agents: dependencies.agents.capabilities(),
      ai_provider: defaultAgentId,
      scm_providers: registrations.scm || [],
      deployment_providers: registrations.deployment || [],
      connectors: providers.map((provider) => ({
        ...provider,
        enabled: dependencies.extensionEnabled(provider.moduleId),
      })),
      contributions: dependencies.extensions.contributions.capabilities(),
      modules: catalog(),
      platform_features: PLATFORM_FEATURES,
    })
  })

  router.get('/api/settings/extensions', () =>
    Response.json({
      extensions: catalog().map((extension) => ({
        ...extension,
        enabled: dependencies.extensionEnabled(extension.id),
      })),
    }),
  )

  router.patch('/api/settings/extensions', async (request) => {
    const input = await readJsonObject(request)
    const id = String(input.id || '')
    const installed = dependencies.extensions.installed(id)
    if (!installed) throw new HttpError('Extension is not installed', 400)
    if (input.enabled === false && installed.extension.manifest.agents?.some((agent) => agent.id === dependencies.defaultAgentId())) {
      throw new HttpError('The active default agent extension cannot be disabled', 400)
    }
    const enabled = Boolean(input.enabled)
    if (!dependencies.toggleExtension) throw new HttpError('Durable extension state is unavailable', 503)
    const result = await dependencies.toggleExtension(id, enabled)
    return Response.json(
      {
        id,
        enabled: result.appliedEnabled,
        desiredEnabled: result.desiredEnabled,
        pending: result.pending,
        error: result.error,
        ...(result.warning ? { warning: result.warning } : {}),
      },
      { status: result.ok ? 200 : 409 },
    )
  })

  return router
}

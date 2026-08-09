import { randomUUID } from 'node:crypto'
import {
  PLATFORM_API_VERSION,
  type DashboardExtension,
  type ExtensionHostServices,
  type ScopedAgentRegistry,
} from '@vertexade/platform-contracts'
import { readJsonObject } from '@vertexade/platform-server/http'
import { resilientFetch } from '@vertexade/platform-server/effect'
import { createAcpAgent } from './agent.ts'
import {
  acpAgentId,
  archiveAcpHarness,
  migrateAcpConfiguration,
  normalizeAcpConfiguration,
  publicAcpHarness,
  replaceAcpConfiguration,
  registryAgentConfiguration,
  setAcpHarnessActive,
  updateAcpHarness,
  updateAcpHarnessEnvironment,
  type AcpConfiguration,
  type AcpHarnessConfiguration,
} from './config.ts'
import { acpSettings } from '../shared/settings.ts'

type AcpContext = { host: ExtensionHostServices }
const registryUrl = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

async function registry() {
  const response = await resilientFetch({
    service: 'ACP registry',
    fetch: globalThis.fetch,
    url: registryUrl,
    timeoutMs: 15_000,
  })
  if (!response.ok) throw new Error(`ACP registry returned HTTP ${response.status}`)
  const value = (await response.json()) as { version?: unknown; agents?: unknown }
  return {
    version: String(value.version || ''),
    agents: Array.isArray(value.agents) ? value.agents : [],
  }
}

function errorResponse(error: unknown, fallback: string, status = 400) {
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status })
}

function registryHarness(configuration: AcpConfiguration, registryAgentId: unknown) {
  return (
    configuration.harnesses.find((harness) => harness.registryAgentId === registryAgentId) ||
    configuration.harnesses.find((harness) => harness.id === 'default' && !harness.command)
  )
}

function withRegistryHarness(
  configuration: AcpConfiguration,
  existing: AcpHarnessConfiguration | undefined,
  harness: AcpHarnessConfiguration,
) {
  if (existing)
    return {
      harnesses: configuration.harnesses.map((candidate) => (candidate.id === existing.id ? harness : candidate)),
    }
  if (configuration.harnesses.length >= 32) throw new Error('ACP supports at most 32 harnesses')
  return { harnesses: [...configuration.harnesses, harness] }
}

function requiredRegistryAgent(agents: unknown[], id: unknown) {
  const selected = agents.find((candidate) => candidate && typeof candidate === 'object' && (candidate as { id?: unknown }).id === id)
  if (!selected) throw new Error('ACP registry agent not found')
  return selected
}

function configuredRegistryHarness(selected: unknown, existing: AcpHarnessConfiguration | undefined) {
  const basis = {
    permissionPolicy: 'approve' as const,
    id: randomUUID(),
    environment: {},
    ...existing,
  }
  return {
    ...registryAgentConfiguration(selected, basis.permissionPolicy, basis.id),
    environment: basis.environment,
  }
}

export function createExtension({ host }: AcpContext): DashboardExtension {
  const configuration = () => normalizeAcpConfiguration(host.settings.read('config', {}))
  const manifest: DashboardExtension['manifest'] = {
    id: 'acp',
    name: 'ACP Agent',
    version: '0.0.1',
    platformApi: PLATFORM_API_VERSION,
    kind: 'ai',
    description: 'Connect multiple local ACP v1 coding harnesses through the standard Agent Client Protocol.',
    catalog: {
      tagline: 'Run multiple local ACP-compatible coding harnesses',
      category: 'automation',
      publisher: { name: 'VertexADE', url: 'https://agentclientprotocol.com' },
      accent: 'violet',
      tags: ['Agent', 'ACP', 'Interoperability'],
      highlights: ['Multiple concurrent ACP harnesses', 'Stable ACP v1 over stdio', 'Review-aware permission handling'],
      links: {
        homepage: 'https://agentclientprotocol.com',
        documentation: 'https://agentclientprotocol.com/get-started/introduction',
      },
    },
    portable: { surfaces: [], settings: acpSettings },
    permissions: ['settings.read', 'settings.write', 'events.emit', 'process.execute'],
    agents: [{ id: 'acp', name: 'ACP Agent', accent: 'violet' }],
  }
  let scopedAgents: ScopedAgentRegistry | null = null
  let registeredAgentIds = new Set<string>()

  function synchronizeAgents() {
    if (!scopedAgents) return
    for (const id of registeredAgentIds) scopedAgents.unregister(id)
    const harnesses = configuration().harnesses
    for (const harness of harnesses) {
      scopedAgents.register(
        createAcpAgent({
          harnessId: harness.id,
          configuration: () => {
            const current = configuration().harnesses.find((candidate) => candidate.id === harness.id)
            return current || harness
          },
        }),
      )
    }
    registeredAgentIds = new Set(harnesses.map((harness) => acpAgentId(harness.id)))
    manifest.agents = harnesses.map((harness) => ({
      id: acpAgentId(harness.id),
      name: harness.name,
      accent: 'violet',
    }))
  }

  function write(next: AcpConfiguration) {
    host.settings.write('config', next)
    synchronizeAgents()
    host.events.emit('acp_settings_updated')
  }

  function response() {
    const harnesses = configuration().harnesses.filter((harness) => !harness.archived)
    return {
      configured: harnesses.some((harness) => harness.active && harness.command),
      harnesses: harnesses.map(publicAcpHarness),
      registry_agent_ids: harnesses.flatMap((harness) => (harness.registryAgentId ? [harness.registryAgentId] : [])),
      protocol_version: 1,
    }
  }

  async function replaceSettings(request: Request) {
    const input = await readJsonObject(request)
    let next = replaceAcpConfiguration(configuration(), input)
    const registryAgentIds = Array.isArray(input.registry_agent_ids) ? input.registry_agent_ids.map(String) : []
    next = {
      harnesses: next.harnesses.filter((harness) => !harness.registryAgentId || registryAgentIds.includes(harness.registryAgentId)),
    }
    if (registryAgentIds.some((id) => !next.harnesses.some((harness) => harness.registryAgentId === id))) {
      const catalog = await registry()
      for (const id of registryAgentIds) {
        if (next.harnesses.some((harness) => harness.registryAgentId === id)) continue
        next = withRegistryHarness(next, undefined, configuredRegistryHarness(requiredRegistryAgent(catalog.agents, id), undefined))
      }
    }
    write(next)
    return Response.json(response())
  }

  async function selectRegistryAgent(request: Request) {
    const input = await readJsonObject(request)
    const catalog = await registry()
    const current = configuration()
    const existing = registryHarness(current, input.id)
    const nextHarness = configuredRegistryHarness(requiredRegistryAgent(catalog.agents, input.id), existing)
    write(withRegistryHarness(current, existing, nextHarness))
    return Response.json(response())
  }

  return {
    manifest,
    migrations: [
      {
        version: 1,
        name: 'canonical-acp-configuration',
        migrate() {
          if (!host.settings.has('config') && !host.settings.has('environment')) return
          host.settings.write('config', migrateAcpConfiguration(host.settings.read('config', {}), host.settings.read('environment', {})))
          host.settings.delete('environment')
        },
      },
    ],
    status: () => {
      const active = configuration().harnesses.filter((harness) => harness.active && !harness.archived && harness.command)
      return active.length
        ? {
            configured: true,
            healthy: true,
            message: `${active.length} active ACP harness${active.length === 1 ? '' : 'es'}`,
          }
        : { configured: false, message: 'Configure and activate an ACP harness in Settings' }
    },
    register(registration) {
      scopedAgents = registration.agents
      synchronizeAgents()
      registration.routes.register({
        method: 'GET',
        path: '/settings',
        availability: 'installed',
        handler: () => Response.json(response()),
      })
      registration.routes.register({
        method: 'POST',
        path: '/settings',
        availability: 'installed',
        handler: async (request) => {
          try {
            return await replaceSettings(request)
          } catch (error) {
            return errorResponse(error, 'Invalid ACP settings')
          }
        },
      })
      registration.routes.register({
        method: 'GET',
        path: '/registry',
        availability: 'installed',
        handler: async () => {
          try {
            return Response.json(await registry())
          } catch (error) {
            return errorResponse(error, 'ACP registry unavailable', 502)
          }
        },
      })
      registration.routes.register({
        method: 'POST',
        path: '/registry',
        availability: 'installed',
        handler: async () => {
          try {
            return Response.json(await registry())
          } catch (error) {
            return errorResponse(error, 'ACP registry unavailable', 502)
          }
        },
      })
      registration.routes.register({
        method: 'POST',
        path: '/registry/select',
        availability: 'installed',
        handler: async (request) => {
          try {
            return await selectRegistryAgent(request)
          } catch (error) {
            return errorResponse(error, 'Could not add ACP registry harness')
          }
        },
      })
      registration.routes.register({
        method: 'POST',
        path: '/harnesses',
        availability: 'installed',
        handler: async (request) => {
          try {
            const current = configuration()
            const input = await readJsonObject(request)
            const emptyDefault = current.harnesses.find((harness) => harness.id === 'default' && !harness.command)
            write(updateAcpHarness(current, input, emptyDefault?.id || randomUUID()))
            return Response.json(response())
          } catch (error) {
            return errorResponse(error, 'Invalid ACP harness settings')
          }
        },
      })
      registration.routes.register({
        method: 'POST',
        path: '/harnesses/:id/active',
        availability: 'installed',
        handler: async (request, context) => {
          try {
            const input = await readJsonObject(request)
            write(setAcpHarnessActive(configuration(), String(context.params.id || ''), input.active !== false))
            return Response.json(response())
          } catch (error) {
            return errorResponse(error, 'Could not update ACP harness')
          }
        },
      })
      registration.routes.register({
        method: 'POST',
        path: '/harnesses/:id/environment',
        availability: 'installed',
        handler: async (request, context) => {
          try {
            write(updateAcpHarnessEnvironment(configuration(), String(context.params.id || ''), await readJsonObject(request)))
            return Response.json(response())
          } catch (error) {
            return errorResponse(error, 'Invalid ACP harness environment')
          }
        },
      })
      registration.routes.register({
        method: 'DELETE',
        path: '/harnesses/:id',
        availability: 'installed',
        handler: (_request, context) => {
          try {
            write(archiveAcpHarness(configuration(), String(context.params.id || '')))
            return Response.json(response())
          } catch (error) {
            return errorResponse(error, 'Could not remove ACP harness')
          }
        },
      })
    },
  }
}

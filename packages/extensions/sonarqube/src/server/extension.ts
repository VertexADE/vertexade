import { SonarQubeClient } from './client.ts'
import { PLATFORM_API_VERSION } from '@vertexade/platform-contracts'
import type { DashboardExtension, ExtensionHostServices, Finding, FindingsProvider } from '@vertexade/platform-contracts'
import {
  createFindingsRefreshTrigger,
  findingsConfig,
  findingsRemediationPrompt,
  registerFindingsApi,
} from '@vertexade/platform-server/findings-api'
import { readJsonObject } from '@vertexade/platform-server/http'
import { guardedIntegrationFetch } from '@vertexade/platform-server/outbound-policy'
import { sonarQubeFindingsSurface } from '../shared/surfaces.ts'
import { sonarQubeSettings } from '../shared/settings.ts'

type Config = { url: string; projectKeys: string[]; token: string }
const defaultConfig: Config = { url: '', projectKeys: [], token: '' }

function selectedProjects(config: Config) {
  return normalizedProjectKeys(config.projectKeys)
}

function normalizedProjectKeys(value: unknown) {
  const values = Array.isArray(value) ? value : String(value || '').split(',')
  return [...new Set(values.map((key) => String(key).trim()).filter(Boolean))]
}

function clientConfig(config: Config) {
  return { url: config.url, projectKeys: selectedProjects(config), token: config.token }
}

function createProvider(fetch: typeof globalThis.fetch): FindingsProvider<Config> {
  const provider: FindingsProvider<Config> = {
    id: 'sonarqube',
    name: 'SonarQube',
    defaultConfig,
    normalizeConfig(input, current = defaultConfig) {
      const rawProjects = input.projectKeys
      const projectKeys = rawProjects === undefined ? selectedProjects(current) : normalizedProjectKeys(rawProjects)
      const url = String(input.url || current.url || '')
        .trim()
        .replace(/\/$/, '')
      return {
        url,
        projectKeys,
        token: String(input.token || '').trim() || (url === current.url ? current.token : ''),
      }
    },
    isConfigured: (config) => Boolean(config.url && selectedProjects(config).length && config.token),
    publicConfig: (config) => ({
      configured: provider.isConfigured(config),
      url: config.url,
      project_keys: selectedProjects(config),
      has_token: Boolean(config.token),
    }),
    async verify(config) {
      const selected = selectedProjects(config)
      const accessible = new Set((await new SonarQubeClient(clientConfig(config), fetch).projects()).map((project) => project.key))
      const unavailable = selected.filter((key) => !accessible.has(key))
      if (unavailable.length) throw new Error(`The token cannot browse the selected SonarQube projects: ${unavailable.join(', ')}`)
    },
    findings: (config) => new SonarQubeClient(clientConfig(config), fetch).findings(),
    findingDetails: (config, findingId) => new SonarQubeClient(clientConfig(config), fetch).findingDetails(findingId),
    remediationPrompt: (finding: Finding, repository, instruction = '') =>
      findingsRemediationPrompt('SonarQube', 'SonarQube code-quality finding', finding, repository, instruction),
  }
  return provider
}

export function migrateSonarQubeConfig(value: Record<string, unknown>): Config {
  const rawProjects = value.projectKeys ?? value.project_keys ?? value.projectKey ?? value.project_key
  return {
    url: String(value.url || '')
      .trim()
      .replace(/\/$/, ''),
    projectKeys: normalizedProjectKeys(rawProjects),
    token: String(value.token || '').trim(),
  }
}

export function createExtension({ host }: { host: ExtensionHostServices }): DashboardExtension {
  const networkFetch = host.network?.fetch || guardedIntegrationFetch
  const provider = createProvider(networkFetch)
  const refreshTrigger = createFindingsRefreshTrigger(provider)
  return {
    migrations: [
      {
        version: 1,
        name: 'canonical-sonarqube-configuration',
        migrate() {
          if (host.settings.has('config')) host.settings.write('config', migrateSonarQubeConfig(host.settings.read('config', {})))
        },
      },
    ],
    manifest: {
      id: 'sonarqube',
      name: 'SonarQube',
      version: '0.0.1',
      platformApi: PLATFORM_API_VERSION,
      kind: 'findings',
      description: 'Investigate and address code-quality findings from SonarQube.',
      catalog: {
        tagline: 'Bring code-quality findings into the delivery workflow',
        category: 'quality',
        publisher: { name: 'VertexADE', url: 'https://www.sonarsource.com/products/sonarqube' },
        icon: { asset: 'assets/icon.svg' },
        accent: 'cyan',
        tags: ['Code quality', 'Findings', 'Remediation'],
        featured: true,
        highlights: ['Select multiple projects', 'Inspect issue evidence', 'Launch repository-aware remediation'],
        links: {
          homepage: 'https://www.sonarsource.com/products/sonarqube',
          documentation: 'https://docs.sonarsource.com/sonarqube-server',
        },
      },
      portable: { surfaces: [sonarQubeFindingsSurface], settings: sonarQubeSettings },
      requires: { agent: true },
      permissions: [
        'settings.read',
        'settings.write',
        'repositories.read',
        'tasks.launch',
        'events.emit',
        'cache.read',
        'cache.write',
        'network.request',
      ],
      contributes: {
        actions: [
          {
            id: 'sonarqube.remediate',
            name: 'Remediate SonarQube finding',
            description: 'Launch isolated engineering work for a SonarQube finding',
          },
        ],
        triggers: [refreshTrigger.capability],
      },
      ui: {
        workResources: [
          {
            kind: 'finding',
            label: 'SonarQube finding',
            tone: 'cyan',
            routeTemplate: '/extensions/sonarqube',
          },
        ],
        commands: [
          {
            id: 'sonarqube.open-findings',
            label: 'Open SonarQube findings',
            description: 'Inspect code-quality findings',
            to: '/extensions/sonarqube',
            keywords: ['quality', 'issues'],
          },
        ],
      },
      providers: [
        { id: 'sonarqube', name: 'SonarQube', kind: 'findings' },
        { id: 'sonarqube', name: 'SonarQube findings', kind: 'inbox' },
        { id: 'sonarqube', name: 'SonarQube findings', kind: 'search' },
      ],
    },
    status: () => ({ configured: provider.isConfigured(findingsConfig(provider, host)) }),
    register(registration) {
      registerFindingsApi(registration, provider, host, refreshTrigger)
      registration.routes.register({
        method: 'POST',
        path: '/projects',
        availability: 'installed',
        async handler(request) {
          const config = provider.normalizeConfig(await readJsonObject(request), findingsConfig(provider, host))
          if (!config.url || !config.token)
            return Response.json({ error: 'Enter the SonarQube server URL and API token first' }, { status: 400 })
          try {
            return Response.json({
              projects: await new SonarQubeClient(clientConfig(config), networkFetch).projects(),
            })
          } catch (error) {
            return Response.json({ error: (error as Error).message }, { status: 400 })
          }
        },
      })
    },
  }
}

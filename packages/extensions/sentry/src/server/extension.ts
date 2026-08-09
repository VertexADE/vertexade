import { SentryClient } from './client.ts'
import { PLATFORM_API_VERSION } from '@vertexade/platform-contracts'
import type { DashboardExtension, ExtensionHostServices, Finding, FindingsProvider } from '@vertexade/platform-contracts'
import {
  createFindingsRefreshTrigger,
  findingsConfig,
  findingsRemediationPrompt,
  registerFindingsApi,
} from '@vertexade/platform-server/findings-api'
import { sentryFindingsSurface } from '../shared/surfaces.ts'
import { sentrySettings } from '../shared/settings.ts'
import { guardedIntegrationFetch } from '@vertexade/platform-server/outbound-policy'

type Config = { url: string; organization: string; project: string; token: string }
const defaultConfig: Config = { url: 'https://sentry.io', organization: '', project: '', token: '' }
function createProvider(fetch: typeof globalThis.fetch): FindingsProvider<Config> {
  const provider: FindingsProvider<Config> = {
    id: 'sentry',
    name: 'Sentry',
    defaultConfig,
    normalizeConfig(input, current = defaultConfig) {
      const url = String(input.url || 'https://sentry.io')
        .trim()
        .replace(/\/$/, '')
      const token = String(input.token || '').trim() || (url === current.url ? current.token : '')
      return {
        url,
        organization: String(input.organization || '').trim(),
        project: String(input.project || '').trim(),
        token,
      }
    },
    isConfigured: (config) => Boolean(config.url && config.organization && config.token),
    publicConfig: (config) => ({
      configured: provider.isConfigured(config),
      url: config.url,
      organization: config.organization,
      project: config.project,
      has_token: Boolean(config.token),
    }),
    async verify(config) {
      await new SentryClient(config, fetch).findings()
    },
    findings: (config, query = 'is:unresolved') => new SentryClient(config, fetch).findings(query),
    findingDetails: (config, findingId) => new SentryClient(config, fetch).findingDetails(findingId),
    remediationPrompt: (finding: Finding, repository, instruction = '') =>
      findingsRemediationPrompt('Sentry', 'Sentry production issue', finding, repository, instruction),
  }
  return provider
}

export function createExtension({ host }: { host: ExtensionHostServices }): DashboardExtension {
  const networkFetch = host.network?.fetch || guardedIntegrationFetch
  const provider = createProvider(networkFetch)
  const refreshTrigger = createFindingsRefreshTrigger(provider)
  return {
    manifest: {
      id: 'sentry',
      name: 'Sentry',
      version: '0.0.1',
      platformApi: PLATFORM_API_VERSION,
      kind: 'findings',
      description: 'Investigate and address production findings from Sentry.',
      catalog: {
        tagline: 'Turn production errors into traceable remediation work',
        category: 'observability',
        publisher: { name: 'VertexADE', url: 'https://sentry.io' },
        icon: { asset: 'assets/icon.svg' },
        accent: 'violet',
        tags: ['Errors', 'Production', 'Findings'],
        featured: true,
        highlights: ['Browse unresolved production issues', 'Inspect complete finding context', 'Launch isolated remediation work'],
        links: { homepage: 'https://sentry.io', documentation: 'https://docs.sentry.io' },
      },
      portable: { surfaces: [sentryFindingsSurface], settings: sentrySettings },
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
            id: 'sentry.remediate',
            name: 'Remediate Sentry finding',
            description: 'Launch isolated engineering work for a Sentry finding',
          },
        ],
        triggers: [refreshTrigger.capability],
      },
      ui: {
        workResources: [
          {
            kind: 'finding',
            label: 'Sentry finding',
            tone: 'violet',
            routeTemplate: '/extensions/sentry',
          },
        ],
        commands: [
          {
            id: 'sentry.open-findings',
            label: 'Open Sentry findings',
            description: 'Inspect unresolved production issues',
            to: '/extensions/sentry',
            keywords: ['errors', 'production'],
          },
        ],
      },
      providers: [
        { id: 'sentry', name: 'Sentry', kind: 'findings' },
        { id: 'sentry', name: 'Sentry findings', kind: 'inbox' },
        { id: 'sentry', name: 'Sentry findings', kind: 'search' },
      ],
    },
    status: () => ({ configured: provider.isConfigured(findingsConfig(provider, host)) }),
    register(registration) {
      registerFindingsApi(registration, provider, host, refreshTrigger)
    },
  }
}

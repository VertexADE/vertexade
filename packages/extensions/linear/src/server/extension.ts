import {
  PLATFORM_API_VERSION,
  type DashboardExtension,
  type ExtensionHostServices,
  type WorkManagementProvider,
  type WorkReferenceProvider,
} from '@vertexade/platform-contracts'
import { LinearClient, normalizeLinearConfig, type LinearConfig } from './client.ts'
import { cachedLinearOverview, registerLinearApi } from './api.ts'
import { createCacheRefreshTrigger } from '@vertexade/platform-server/cache-trigger'
import { linearIssuesSurface } from '../shared/surfaces.ts'
import { linearSettings } from '../shared/settings.ts'

type Value = Record<string, any>

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function configured(config: LinearConfig) {
  if (!config.apiKey) return false
  return config.teamIds.length > 0
}

function matchesReference(issue: Value, query: string) {
  if (!query) return true
  return [issue.identifier, issue.title, issue.description, issue.project?.name].map(text).join(' ').toLowerCase().includes(query)
}

function optionalText(value: unknown) {
  const valueText = text(value)
  return valueText ? valueText : null
}

function issueState(issue: Value) {
  return optionalText(issue.state?.name)
}
function issueTeam(issue: Value) {
  return text(issue.team?.name)
}
function issueProject(issue: Value) {
  return text(issue.project?.name)
}
function issueAssignee(issue: Value) {
  return text(issue.assignee?.name)
}

function linearReference(issue: Value) {
  return {
    provider: 'linear',
    kind: 'issue',
    externalId: String(issue.id),
    label: `${issue.identifier}: ${issue.title}`,
    url: issue.url,
    state: issueState(issue),
    summary: optionalText(issue.description),
    metadata: {
      identifier: issue.identifier,
      description: text(issue.description),
      team: issueTeam(issue),
      project: issueProject(issue),
      priority: issue.priority,
      assignee: issueAssignee(issue),
    },
  }
}

export function createExtension({ host }: { host: ExtensionHostServices }): DashboardExtension {
  const refreshTrigger = createCacheRefreshTrigger({
    id: 'linear.board-refreshed',
    name: 'Linear board refreshed',
    description: 'When Linear issues are fetched from the upstream service.',
    resource: 'board',
    properties: { count: { type: 'integer', title: 'Issue count', minimum: 0 } },
  })
  const provider: WorkManagementProvider<LinearConfig, LinearClient> = {
    id: 'linear',
    name: 'Linear',
    normalizeConfig: (input = {}) => normalizeLinearConfig(input),
    createClient: (config) => new LinearClient({ apiKey: config.apiKey, teamIds: config.teamIds }),
  }
  const config = () => normalizeLinearConfig(host.settings.read('config', { apiKey: '', teamIds: [], webhookSecret: '' }))
  const references: WorkReferenceProvider = {
    id: 'linear',
    name: 'Linear',
    async references(query = '', context) {
      const current = config()
      if (!configured(current)) return []
      const issues = (await cachedLinearOverview(provider.createClient(current), host, refreshTrigger, context?.forceRefresh)).value.issues
      const needle = query.trim().toLowerCase()
      return issues.filter((issue) => matchesReference(issue, needle)).map(linearReference)
    },
  }
  return {
    manifest: {
      id: 'linear',
      name: 'Linear',
      version: '0.0.1',
      platformApi: PLATFORM_API_VERSION,
      kind: 'work-management',
      description: 'Browse, create, update, and launch repository work from Linear issues.',
      catalog: {
        tagline: 'Turn Linear issues into connected delivery work',
        category: 'planning',
        publisher: { name: 'VertexADE', url: 'https://linear.app' },
        icon: { asset: 'assets/icon.svg' },
        accent: 'violet',
        tags: ['Planning', 'Issues', 'Work management'],
        featured: true,
        highlights: ['Browse selected teams', 'Create and update issues', 'Launch linked repository work'],
        links: { homepage: 'https://linear.app', documentation: 'https://linear.app/developers' },
      },
      portable: { surfaces: [linearIssuesSurface], settings: linearSettings },
      requires: { agent: true },
      permissions: ['settings.read', 'settings.write', 'repositories.read', 'tasks.launch', 'events.emit', 'cache.read', 'cache.write'],
      contributes: {
        triggers: [refreshTrigger.capability],
      },
      ui: {
        workResources: [
          {
            kind: 'issue',
            label: 'Linear issue',
            tone: 'violet',
            routeTemplate: '/extensions/linear',
          },
        ],
        commands: [
          {
            id: 'linear.open-issues',
            label: 'Open Linear issues',
            description: 'Browse connected planning work',
            to: '/extensions/linear',
            keywords: ['planning', 'issues', 'projects'],
          },
        ],
      },
      providers: [
        { id: 'linear', name: 'Linear', kind: 'work-management' },
        { id: 'linear', name: 'Linear', kind: 'work-reference' },
      ],
    },
    status: () => ({ configured: configured(config()) }),
    register(registration) {
      registration.providers.workManagement.register(provider)
      registration.providers.workReferences.register(references)
      registration.triggers.register(refreshTrigger.capability)
      registerLinearApi(registration, provider, host, refreshTrigger)
    },
  }
}

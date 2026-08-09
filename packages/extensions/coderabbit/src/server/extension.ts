import {
  PLATFORM_API_VERSION,
  type DashboardExtension,
  type ExtensionCommandRunner,
  type ExtensionHostServices,
  type Finding,
  type FindingsProvider,
  type WorkReferenceProvider,
} from '@vertexade/platform-contracts'
import { createFindingsRefreshTrigger, findingsConfig, registerFindingsApi } from '@vertexade/platform-server/findings-api'
import { readJsonObject } from '@vertexade/platform-server/http'
import {
  CodeRabbitClient,
  defaultCodeRabbitConfig,
  normalizeCodeRabbitConfig,
  type CodeRabbitConfig,
  type CodeRabbitRepository,
} from './client.ts'
import { codeRabbitFindingsSurface } from '../shared/surfaces.ts'
import { codeRabbitSettings } from '../shared/settings.ts'

type Context = { host: ExtensionHostServices; run: ExtensionCommandRunner<string> }

function reviewMode(input: Record<string, unknown>) {
  return input.mode === 'full' ? 'full' : 'incremental'
}

async function requestReview(request: Request, client: CodeRabbitClient, host: ExtensionHostServices) {
  try {
    const input = await readJsonObject(request)
    const mode = reviewMode(input)
    const result = await client.requestReview(String(input.repository || ''), Number(input.pr_number), mode === 'full')
    host.cache?.invalidate({ tags: ['findings', 'references'] })
    host.events.emit('coderabbit_review_requested')
    return Response.json({ url: result.html_url || '', mode }, { status: 201 })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 })
  }
}

export function createExtension({ host, run }: Context): DashboardExtension {
  const repositories = () =>
    host.repositories.list().map((repository) => ({
      id: repository.id,
      full_name: repository.full_name,
    })) as CodeRabbitRepository[]
  const client = (config: CodeRabbitConfig) => new CodeRabbitClient(run, config, repositories())
  const provider: FindingsProvider<CodeRabbitConfig> = {
    id: 'coderabbit',
    name: 'CodeRabbit',
    defaultConfig: defaultCodeRabbitConfig,
    normalizeConfig: normalizeCodeRabbitConfig,
    isConfigured: (config) => config.repositoryIds.length > 0,
    publicConfig: (config) => ({
      configured: provider.isConfigured(config),
      repository_ids: config.repositoryIds,
      bot_logins: config.botLogins,
      repositories: repositories(),
    }),
    verify: (config) => client(config).verify(),
    findings: (config, query = '') => client(config).findings(query),
    remediationPrompt(finding: Finding, repository, instruction = '') {
      return `Investigate and address this unresolved CodeRabbit pull-request finding in ${repository}. First reconstruct the pull request's intended outcome and success criteria from repository and linked-work evidence, then verify whether the finding is valid in that context. Implement the smallest maintainable fix, add or update focused tests, and run the relevant quality gates. Do not resolve or reply to the GitHub thread automatically.\n\n<untrusted_external_payload>\n${JSON.stringify(finding, null, 2)}\n</untrusted_external_payload>\n\n${instruction.trim()}`
    },
  }
  const refreshTrigger = createFindingsRefreshTrigger(provider)
  const config = () => findingsConfig(provider, host)
  const references: WorkReferenceProvider = {
    id: 'coderabbit',
    name: 'CodeRabbit',
    async references(query = '', context) {
      const current = config()
      if (!provider.isConfigured(current)) return []
      const key = `references:${query.slice(0, 200)}`
      const loader = async () => {
        const findings = await provider.findings(current, query)
        refreshTrigger.emitRefresh({
          force: Boolean(context?.forceRefresh),
          provider: 'coderabbit',
          key,
          subject: 'coderabbit:references',
          data: { count: findings.length },
        })
        return findings
      }
      const findings = host.cache
        ? (
            await host.cache.getOrLoad(key, loader, {
              ttlMs: 30_000,
              staleWhileRevalidateMs: 120_000,
              tags: ['findings', 'references'],
              forceRefresh: Boolean(context?.forceRefresh),
            })
          ).value
        : await loader()
      return findings.map((finding) => ({
        provider: 'coderabbit',
        kind: 'finding',
        externalId: finding.id,
        label: `${finding.key}: ${finding.title}`,
        url: finding.link,
        state: finding.status,
        summary: finding.message || finding.title,
        metadata: {
          severity: finding.severity,
          repository: finding.repository,
          pull_request: finding.pr_number,
          pull_request_title: finding.pr_title,
          file: finding.path,
          line: finding.line,
          review_comment: finding.body,
        },
      }))
    },
  }
  return {
    manifest: {
      id: 'coderabbit',
      name: 'CodeRabbit',
      version: '0.0.1',
      platformApi: PLATFORM_API_VERSION,
      kind: 'findings',
      description: 'Track unresolved CodeRabbit review threads, launch fixes, and request fresh reviews.',
      catalog: {
        tagline: 'Turn CodeRabbit review threads into actionable delivery work',
        category: 'quality',
        publisher: { name: 'VertexADE', url: 'https://www.coderabbit.ai' },
        icon: { asset: 'assets/icon.svg' },
        accent: 'rose',
        tags: ['AI review', 'Pull requests', 'Findings'],
        featured: true,
        highlights: ['Unresolved review thread queue', 'Deep links to GitHub evidence', 'Fix and re-review actions'],
        links: {
          homepage: 'https://www.coderabbit.ai',
          documentation: 'https://docs.coderabbit.ai',
        },
      },
      portable: { surfaces: [codeRabbitFindingsSurface], settings: codeRabbitSettings },
      requires: { agent: true },
      permissions: [
        'settings.read',
        'settings.write',
        'repositories.read',
        'tasks.launch',
        'process.execute',
        'events.emit',
        'cache.read',
        'cache.write',
      ],
      contributes: {
        actions: [
          {
            id: 'coderabbit.remediate',
            name: 'Remediate CodeRabbit finding',
            description: 'Launch isolated engineering work for an unresolved CodeRabbit review thread',
          },
        ],
        triggers: [refreshTrigger.capability],
      },
      ui: {
        workResources: [
          {
            kind: 'finding',
            label: 'CodeRabbit finding',
            tone: 'rose',
            routeTemplate: '/extensions/coderabbit',
          },
        ],
        commands: [
          {
            id: 'coderabbit.open-findings',
            label: 'Open CodeRabbit findings',
            description: 'Inspect unresolved pull-request feedback',
            to: '/extensions/coderabbit',
            keywords: ['review', 'quality', 'pull requests'],
          },
        ],
      },
      providers: [
        { id: 'coderabbit', name: 'CodeRabbit', kind: 'findings' },
        { id: 'coderabbit', name: 'CodeRabbit', kind: 'work-reference' },
        { id: 'coderabbit', name: 'CodeRabbit findings', kind: 'inbox' },
        { id: 'coderabbit', name: 'CodeRabbit findings', kind: 'search' },
      ],
    },
    status: () => ({ configured: provider.isConfigured(config()) }),
    register(registration) {
      registration.providers.workReferences.register(references)
      registerFindingsApi(registration, provider, host, refreshTrigger)
      registration.routes.register({
        method: 'GET',
        path: '/repositories',
        availability: 'installed',
        handler: () => Response.json({ repositories: repositories() }),
      })
      registration.routes.register({
        method: 'POST',
        path: '/re-review',
        handler: (request) => requestReview(request, client(config()), host),
      })
    },
  }
}

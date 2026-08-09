import type {
  ExtensionCacheMetadata,
  ExtensionHostServices,
  ExtensionRegistrationContext,
  Finding,
  FindingsProvider,
} from '@vertexade/platform-contracts'
import { readJsonObject } from './http.ts'
import { createCacheRefreshTrigger, type CacheRefreshTrigger } from './cache-trigger.ts'

export function findingsConfig<TConfig>(provider: FindingsProvider<TConfig>, host: ExtensionHostServices) {
  return host.settings.read('config', provider.defaultConfig)
}

export function createFindingsRefreshTrigger(provider: Pick<FindingsProvider, 'id' | 'name'>) {
  return createCacheRefreshTrigger({
    id: `${provider.id}.findings-refreshed`,
    name: `${provider.name} findings refreshed`,
    description: `When ${provider.name} findings are fetched from the upstream service.`,
    resource: 'findings',
    properties: { count: { type: 'integer', title: 'Finding count', minimum: 0 } },
  })
}

export function findingsRemediationPrompt(source: string, findingKind: string, finding: unknown, repository: string, instruction = '') {
  return `Investigate and address this ${findingKind} in ${repository}.\n\n${JSON.stringify(finding, null, 2)}\n\nValidate the finding against the repository, identify the root cause, implement the safest maintainable fix, add or update focused tests, and run relevant quality gates. Do not change the finding status in ${source}; the user will verify the fix there after analysis. ${instruction.trim()}`
}

async function cachedFindingDetails<TConfig>(
  request: Request,
  findingId: string,
  config: TConfig,
  provider: FindingsProvider<TConfig>,
  host: ExtensionHostServices,
  refreshTrigger?: CacheRefreshTrigger,
) {
  const forceRefresh = new URL(request.url).searchParams.get('force_refresh') === '1'
  const key = cacheKey('finding', findingId)
  const loader = async () => {
    const value = await provider.findingDetails!(config, findingId)
    refreshTrigger?.emitRefresh({
      force: forceRefresh,
      provider: provider.id,
      key,
      subject: `${provider.id}:finding:${findingId}`,
    })
    return value
  }
  if (!host.cache) return { value: await loader(), cache: undefined }
  return host.cache.getOrLoad(key, loader, {
    ttlMs: 60_000,
    staleWhileRevalidateMs: 300_000,
    tags: ['findings', 'finding-details'],
    forceRefresh,
  })
}

function findingDetailsUnavailable<TConfig>(
  findingId: string | undefined,
  provider: FindingsProvider<TConfig>,
  host: ExtensionHostServices,
) {
  if (!findingId) return Response.json({ error: 'Finding id is required' }, { status: 400 })
  if (!provider.isConfigured(findingsConfig(provider, host)))
    return Response.json({ error: `Configure ${provider.name} first` }, { status: 503 })
  return null
}

function findingDetailsResult(result: { value: Finding; cache: ExtensionCacheMetadata | undefined }) {
  return Response.json(result.cache ? { ...result.value, cache: result.cache } : result.value)
}

function cacheKey(prefix: string, value: string) {
  let hash = 0
  for (const character of value) hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0
  return `${prefix}:${hash.toString(36)}`
}

function findingText(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function portableFinding(finding: Finding) {
  const location = [
    findingText(finding.path || finding.file || finding.component || (finding.line ? finding.message : '')),
    finding.line ? findingText(finding.line) : '',
  ]
    .filter(Boolean)
    .join(':')
  const updated = findingText(
    finding.lastSeen || finding.last_seen || finding.updatedAt || finding.updated_at || finding.createdAt || finding.created_at,
  )
  const fields = [
    { name: 'Severity', value: findingText(finding.severity), style: 'badge', placement: 'card' },
    { name: 'Status', value: findingText(finding.status), style: 'badge', placement: 'card' },
    { name: 'Project', value: findingText(finding.project), style: 'text', placement: 'card' },
    {
      name: 'Type',
      value: findingText(finding.type || finding.issue_type),
      style: 'badge',
      placement: 'card',
    },
    {
      name: 'Repository',
      value: findingText(finding.repository),
      style: 'text',
      placement: 'detail',
    },
    { name: 'Location', value: location, style: 'text', placement: 'detail' },
    { name: 'Last seen', value: updated, style: 'date', placement: 'detail' },
    { name: 'Message', value: findingText(finding.message), style: 'text', placement: 'detail' },
    {
      name: 'Review comment',
      value: findingText(finding.body),
      style: 'text',
      placement: 'detail',
    },
    {
      name: 'Pull request',
      value: finding.pr_number ? `#${findingText(finding.pr_number)} ${findingText(finding.pr_title)}` : '',
      style: 'text',
      placement: 'detail',
    },
    {
      name: 'Evidence',
      value: findingText(finding.link),
      style: 'links',
      placement: 'detail',
      relation: {
        items: finding.link ? [{ id: String(finding.id), title: 'Open provider evidence', url: finding.link }] : [],
      },
    },
  ].filter((field) => field.value || field.name === 'Evidence')
  return {
    ...finding,
    portable_title: [findingText(finding.key), findingText(finding.title)].filter(Boolean).join(': ') || 'Untitled finding',
    portable_fields: fields,
  }
}

export function registerFindingsApi<TConfig>(
  registration: ExtensionRegistrationContext,
  provider: FindingsProvider<TConfig>,
  host: ExtensionHostServices,
  refreshTrigger?: CacheRefreshTrigger,
) {
  registration.providers.findings.register(provider)
  registration.providers.inbox.register({
    id: provider.id,
    name: `${provider.name} findings`,
    async items(context) {
      const config = findingsConfig(provider, host)
      if (!provider.isConfigured(config)) return []
      const findings = (await cachedFindings(config, '', Boolean(context?.forceRefresh))).value
      return findings.slice(0, 25).map((finding) => {
        const severity = String(finding.severity || '').toLowerCase()
        const createdAt = String(finding.lastSeen || finding.updatedAt || finding.updated_at || '')
        return {
          id: String(finding.id),
          type: 'finding',
          severity: ['fatal', 'critical', 'error', 'high', 'blocker'].includes(severity) ? ('error' as const) : ('warning' as const),
          title: finding.title,
          summary: finding.message || `${finding.severity} ${finding.status} finding`,
          source: provider.name,
          createdAt,
          href: `/extensions/${provider.id}`,
          actionLabel: 'Investigate',
          unread: false,
        }
      })
    },
  })
  registration.providers.search.register({
    id: provider.id,
    name: `${provider.name} findings`,
    async search(query, context) {
      const config = findingsConfig(provider, host)
      if (!provider.isConfigured(config)) return []
      const normalizedQuery = query.toLowerCase()
      const findings = (await cachedFindings(config, '', Boolean(context?.forceRefresh))).value
      return findings
        .filter((finding) =>
          [finding.id, finding.key, finding.title, finding.message, finding.severity, finding.status, finding.project].some((value) =>
            String(value || '')
              .toLowerCase()
              .includes(normalizedQuery),
          ),
        )
        .slice(0, 8)
        .map((finding) => ({
          id: String(finding.id),
          type: `${provider.name} finding`,
          title: finding.title,
          subtitle: [finding.severity, finding.project].filter(Boolean).join(' · '),
          to: `/extensions/${provider.id}`,
        }))
    },
  })
  if (refreshTrigger) registration.triggers.register(refreshTrigger.capability)
  async function cachedFindings(config: TConfig, query: string, forceRefresh = false) {
    const key = cacheKey('findings', query)
    const loader = async () => {
      const value = await provider.findings(config, query)
      refreshTrigger?.emitRefresh({
        force: forceRefresh,
        provider: provider.id,
        key,
        subject: `${provider.id}:findings`,
        data: { count: value.length },
      })
      return value
    }
    if (!host.cache) return { value: await loader(), cache: undefined }
    return host.cache.getOrLoad(key, loader, {
      ttlMs: 30_000,
      staleWhileRevalidateMs: 120_000,
      tags: ['findings'],
      forceRefresh,
    })
  }

  async function remediate(input: Record<string, unknown>, findingId: string) {
    const repository = host.repositories.get(Number(input.repositoryId ?? input.repository_id))
    if (!repository) throw new Error('Choose a repository')
    const config = findingsConfig(provider, host)
    if (!provider.isConfigured(config)) throw new Error(`Configure ${provider.name} first`)
    const findings = (await cachedFindings(config, '')).value
    const finding = findings.find((item) => item.id === findingId || item.key === findingId)
    if (!finding) throw new Error('Finding not found')
    const prompt = provider.remediationPrompt(finding, repository.full_name, String(input.instruction || ''))
    return host.tasks.launch(
      repository,
      `${provider.name}: ${finding.title}`.slice(0, 100),
      prompt,
      input.createPullRequest !== false && input.create_pr !== false,
      'fix',
      {
        workspaceMode: 'combined',
        source: {
          provider: provider.id,
          kind: 'finding',
          externalId: String(finding.id),
          role: 'source',
          label: finding.title,
          url: finding.link,
          state: finding.status,
          primary: true,
          metadata: { severity: finding.severity, project: finding.project },
        },
      },
    )
  }

  registration.actions.register({
    id: `${provider.id}.remediate`,
    name: `Remediate ${provider.name} finding`,
    description: `Launch isolated engineering work for a ${provider.name} finding`,
    inputSchema: {
      type: 'object',
      required: ['findingId', 'repositoryId'],
      additionalProperties: false,
      properties: {
        findingId: { type: 'string', minLength: 1 },
        repositoryId: { type: 'integer', minimum: 1 },
        instruction: { type: 'string', maxLength: 20_000 },
        createPullRequest: { type: 'boolean' },
      },
    },
    timeoutMs: 120_000,
    execute(input) {
      const value = input as Record<string, unknown>
      return remediate(value, String(value.findingId || ''))
    },
  })
  registration.routes.register({
    method: 'GET',
    path: '/settings',
    availability: 'installed',
    handler: () => Response.json(provider.publicConfig(findingsConfig(provider, host))),
  })
  registration.routes.register({
    method: 'POST',
    path: '/settings',
    availability: 'installed',
    async handler(request) {
      const value = provider.normalizeConfig(await readJsonObject(request), findingsConfig(provider, host))
      if (!provider.isConfigured(value))
        return Response.json({ error: `${provider.name} connection settings are incomplete` }, { status: 400 })
      try {
        await provider.verify(value)
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 })
      }
      host.settings.write('config', value)
      host.cache?.invalidate()
      host.events.emit(`${provider.id}_settings_updated`)
      return Response.json(provider.publicConfig(value))
    },
  })
  registration.routes.register({
    method: 'GET',
    path: '/findings',
    async handler(request) {
      const config = findingsConfig(provider, host)
      if (!provider.isConfigured(config)) return Response.json({ configured: false, findings: [], repositories: [] })
      const search = new URL(request.url).searchParams
      const query = search.get('query') || ''
      const result = await cachedFindings(config, query, search.get('force_refresh') === '1')
      return Response.json({
        configured: true,
        findings: result.value.map(portableFinding),
        repositories: host.repositories.list(),
        portable_group_fields: [{ field: 'Severity' }, { field: 'Status' }, { field: 'Project' }],
        ...(result.cache ? { cache: result.cache } : {}),
      })
    },
  })
  registration.routes.register({
    method: 'GET',
    path: '/findings/:findingId',
    async handler(request, { params }) {
      const findingId = params.findingId
      const unavailable = findingDetailsUnavailable(findingId, provider, host)
      if (unavailable) return unavailable
      const config = findingsConfig(provider, host)
      try {
        if (provider.findingDetails)
          return findingDetailsResult(await cachedFindingDetails(request, String(findingId), config, provider, host, refreshTrigger))
        const findings = (await cachedFindings(config, '', new URL(request.url).searchParams.get('force_refresh') === '1')).value
        const finding = findings.find((item) => item.id === findingId || item.key === findingId)
        return finding ? Response.json(finding) : Response.json({ error: 'Finding not found' }, { status: 404 })
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 502 })
      }
    },
  })
  registration.routes.register({
    method: 'POST',
    path: '/findings/:findingId/thread',
    async handler(request, { params }) {
      const input = await readJsonObject(request)
      try {
        return Response.json(await remediate(input, String(params.findingId || '')), {
          status: 202,
        })
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 })
      }
    },
  })
}

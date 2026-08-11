import { createServer } from 'node:http'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const contractVersion = 1

function collectionSurface(id, title, options = {}) {
  return {
    contractVersion,
    id,
    kind: 'collection',
    title,
    description: options.description,
    source: { path: `/${id}`, itemsPath: 'items' },
    item: {
      idPath: 'id',
      titlePath: 'title',
      subtitlePath: 'subtitle',
      fieldsPath: 'fields',
      fieldNamePath: 'name',
      fieldValuePath: 'value',
      fieldStylePath: 'style',
      fieldPlacementPath: 'placement',
    },
    views: { list: true },
    actions: options.actions || [],
  }
}

const fixtureSettings = {
  contractVersion,
  id: 'settings',
  title: 'Extension settings',
  description: 'Deterministic device-smoke configuration.',
  source: { path: '/settings', configuredPath: 'configured' },
  fields: [{ name: 'label', label: 'Fixture label', type: 'text', required: true }],
  submit: { method: 'POST', path: '/settings', label: 'Save settings', successMessage: 'Fixture settings saved.' },
  actions: [
    {
      id: 'reset',
      label: 'Reset settings',
      method: 'DELETE',
      path: '/settings',
      intent: 'reset',
      successMessage: 'Fixture settings reset.',
      confirm: {
        title: 'Reset fixture settings?',
        description: 'This only resets deterministic smoke-test data.',
        confirmLabel: 'Reset',
        destructive: true,
      },
    },
  ],
}

function fixtureModule({ id, name, description, surface, settings, enabled = true }) {
  return {
    id,
    name,
    version: '0.0.1',
    platformApi: '1',
    kind: 'integration',
    description,
    permissions: ['settings.read', 'settings.write'],
    portable: { surfaces: surface ? [surface] : [], ...(settings ? { settings } : {}) },
    installed: true,
    enabled,
    installation: { origin: 'bundled', removable: false },
    lifecycle: enabled ? 'ready' : 'disabled',
    configured: true,
  }
}

export const moduleCatalog = {
  platformApi: '1',
  platformFeatures: [],
  diagnostics: [],
  modules: [
    fixtureModule({
      id: 'work',
      name: 'Work',
      description: 'Outcomes and agent threads.',
      surface: collectionSurface('work', 'Work queue', {
        description: 'Prioritized work ready for an agent thread.',
        actions: [
          {
            id: 'start-thread',
            label: 'Start agent thread',
            method: 'POST',
            path: '/work/{id}/threads',
            intent: 'launch-work',
            inputs: [{ name: 'focus', label: 'Thread focus', type: 'textarea', required: true, defaultValue: 'Verify the fixture.' }],
          },
        ],
      }),
    }),
    fixtureModule({
      id: 'agents',
      name: 'Agents',
      description: 'Available agent providers.',
      surface: collectionSurface('agents', 'Agents', { description: 'Selectable coding agents.' }),
    }),
    fixtureModule({
      id: 'pull-requests',
      name: 'Pull requests',
      description: 'Pull requests waiting for review.',
      surface: collectionSurface('pull-requests', 'Pull requests', { description: 'Review queue.' }),
    }),
    fixtureModule({
      id: 'settings',
      name: 'Extension settings',
      description: 'Disabled but still configurable.',
      settings: fixtureSettings,
      enabled: false,
    }),
  ],
}

const collections = {
  '/api/extensions/work/work': {
    items: [
      {
        id: 'work-1',
        title: 'Make mobile delivery effortless',
        subtitle: 'Ready for an agent',
        fields: [{ name: 'Status', value: 'Ready', style: 'badge', placement: 'card' }],
      },
    ],
  },
  '/api/extensions/agents/agents': {
    items: [
      {
        id: 'codex',
        title: 'Codex',
        subtitle: 'Default coding agent',
        fields: [{ name: 'State', value: 'Selectable', style: 'badge', placement: 'card' }],
      },
    ],
  },
  '/api/extensions/pull-requests/pull-requests': {
    items: [
      {
        id: 'pr-299',
        title: '#299 Improve release quality',
        subtitle: 'vertexade/vertexade',
        fields: [
          { name: 'Review', value: 'Ready', style: 'badge', placement: 'card' },
          { name: 'Author', value: 'VertexADE engineer', style: 'person', placement: 'detail' },
        ],
      },
    ],
  },
}

const settingsPath = '/api/extensions/settings/settings'

function readModelEntry(key, value, position = 0) {
  return { key: String(key), value, sourceUpdatedAt: value.updated_at || value.activity_at || null, position }
}

const workspaceReadModel = {
  instanceId: 'mobile-fixture-instance',
  version: 1,
  updates: {
    repositories: {
      version: 1,
      mode: 'replace',
      entries: [readModelEntry(1, { id: 1, full_name: 'vertexade/fixture', local_path: '/fixture', synced_at: null })],
    },
    pullRequests: {
      version: 1,
      mode: 'replace',
      entries: [readModelEntry(299, {
        id: 299,
        repo_id: 1,
        full_name: 'vertexade/fixture',
        number: 299,
        title: 'Improve release quality',
        author: 'VertexADE engineer',
        url: 'https://example.test/vertexade/fixture/pull/299',
        base_ref: 'main',
        head_ref: 'release-quality',
        draft: 0,
        checks_pending: 0,
        checks_failed: 0,
        review_decision: 'REVIEW_REQUIRED',
        updated_at: '2026-08-11T10:00:00Z',
      })],
    },
    workItems: {
      version: 1,
      mode: 'replace',
      entries: [readModelEntry(1, {
        id: 1,
        key: 'W-0001',
        title: 'Make mobile delivery effortless',
        description: 'Prioritized work ready for an agent thread.',
        kind: 'implementation',
        state: 'active',
        priority: 'high',
        primary_repository_id: 1,
        repository_names: ['vertexade/fixture'],
        threads: [{ id: 1 }],
        attention: null,
        archived_at: null,
        updated_at: '2026-08-11T10:00:00Z',
      })],
    },
    agentThreads: {
      version: 1,
      mode: 'replace',
      entries: [readModelEntry(1, {
        id: 1,
        work_item_id: 1,
        full_name: 'vertexade/fixture',
        status: 'running',
        agent_id: 'codex',
        agent_name: 'Codex',
        task_title: 'Make mobile delivery effortless',
        latest_activity: 'Verifying the mobile fixture.',
        activity_at: '2026-08-11T10:05:00Z',
        created_at: '2026-08-11T10:00:00Z',
        branch_name: 'feature/mobile-delivery',
        linked_pr_number: null,
        linked_pr_url: null,
        archived_at: null,
      })],
    },
  },
}

const pullRequestDetails = {
  title: 'Improve release quality',
  body: 'Make the mobile release path deterministic and easy to verify.',
  url: 'https://example.test/vertexade/fixture/pull/299',
  author: { login: 'vertexade-engineer', name: 'VertexADE engineer' },
  createdAt: '2026-08-11T09:00:00Z',
  updatedAt: '2026-08-11T10:00:00Z',
  additions: 84,
  deletions: 12,
  changedFiles: 3,
  commits: [{ oid: 'abc123def456', messageHeadline: 'Improve release quality', messageBody: '', authoredDate: '2026-08-11T09:20:00Z', authors: [{ login: 'vertexade-engineer', name: 'VertexADE engineer' }] }],
  comments: [{ id: 'comment-1', author: { login: 'reviewer' }, body: 'Please verify this on a physical iPhone.', createdAt: '2026-08-11T09:40:00Z' }],
  reviews: [{ id: 'review-1', author: { login: 'reviewer' }, body: 'The test coverage looks good.', state: 'APPROVED', createdAt: '2026-08-11T09:50:00Z' }],
  statusCheckRollup: [{ name: 'mobile-check', conclusion: 'SUCCESS', detailsUrl: 'https://example.test/checks/mobile' }],
  assignees: [{ login: 'vertexade-engineer', name: 'VertexADE engineer' }],
  milestone: { title: 'Mobile parity' },
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: 'REVIEW_REQUIRED',
  headRefName: 'release-quality',
  baseRefName: 'main',
  isDraft: false,
  labels: [{ name: 'mobile', color: '37d67a' }],
  reviewThreads: [{ isResolved: false, comments: [] }],
  diff_summary: { files: [{ path: 'apps/mobile/app/index.tsx', additions: 42, deletions: 6, status: 'modified', binary: false }] },
  diff: 'diff --git a/apps/mobile/app/index.tsx b/apps/mobile/app/index.tsx\n+full mobile overview',
  scm_provider_name: 'GitHub',
}

const workItemDetails = {
  id: 1,
  key: 'W-0001',
  title: 'Make mobile delivery effortless',
  description: 'Prioritized work ready for an agent thread.',
  kind: 'implementation',
  state: 'active',
  priority: 'high',
  repository_names: ['vertexade/fixture'],
  attention: null,
  owner: 'VertexADE engineer',
  created_at: '2026-08-11T09:00:00Z',
  updated_at: '2026-08-11T10:05:00Z',
  resources: [{ id: 1, kind: 'pull_request', label: 'PR #299', url: 'https://example.test/vertexade/fixture/pull/299', state: 'open', role: 'delivery', is_primary: 1 }],
  threads: [workspaceReadModel.updates.agentThreads.entries[0].value],
  events: [{ id: 1, event_type: 'thread_started', summary: 'Codex thread started', actor: 'VertexADE engineer', created_at: '2026-08-11T10:00:00Z' }],
  relations: [{ key: 'W-0002', title: 'Publish the release', state: 'backlog', relation: 'blocks' }],
  context_transfers: [{ id: 1, status: 'completed', instruction: 'Carry the release verification forward.', error: '', created_at: '2026-08-11T10:01:00Z' }],
}

const threadLog = {
  ...workspaceReadModel.updates.agentThreads.entries[0].value,
  thread_id: 'fixture-thread-1',
  can_steer: true,
  prompt: 'Make mobile delivery effortless and verify it.',
  result_text: '',
  review_details: '',
  review_summary: '',
  content: 'Agent is verifying the mobile fixture.',
  events: [{ id: 'event-1', kind: 'assistant', title: 'Verification', text: 'Checking the iOS release flow.', time: '2026-08-11T10:05:00Z', status: 'running' }],
  queued_follow_ups: [{ id: 1, prompt: 'Also validate the PR overview.', queued_at: '2026-08-11T10:04:00Z' }],
  input_questions: null,
  diff_summary: { additions: 84, deletions: 12, files: [{ path: 'apps/mobile/app/index.tsx', additions: 42, deletions: 6, status: 'modified', binary: false }] },
}

const fixedRoutes = new Map([
  ['GET /health', () => ({ status: 200, body: { ok: true } })],
  ['GET /api/backends', () => ({ status: 200, body: { backends: [{ id: 'fixture', label: 'Fixture server', namespace: 0, isDefault: true, connected: true, lastConnectedAt: null, error: null, apiPath: '/api/backends/fixture' }] } })],
  ['GET /api/modules', () => ({ status: 200, body: moduleCatalog })],
  ['GET /api/read-model', () => ({ status: 200, body: workspaceReadModel })],
  ['GET /api/pulls/1/299/details', () => ({ status: 200, body: pullRequestDetails })],
  ['POST /api/pulls/1/299/work', () => ({ status: 200, body: { id: 1, key: 'W-0001' } })],
  ['GET /api/work-items/1', () => ({ status: 200, body: workItemDetails })],
  ['PATCH /api/work-items/1', (body) => ({ status: 200, body: { ...workItemDetails, state: String(body?.state || workItemDetails.state) } })],
  ['GET /api/agent-threads/1/log', () => ({ status: 200, body: threadLog })],
  ['GET /api/agent-threads/1/diff', () => ({ status: 200, body: { diff: 'diff --git a/apps/mobile/app/index.tsx b/apps/mobile/app/index.tsx\n+full thread view', diff_summary: threadLog.diff_summary } })],
  ['POST /api/agent-threads/1/queue', () => ({ status: 202, body: { queued: true } })],
  ['POST /api/agent-threads/1/steer', () => ({ status: 202, body: { steered: true } })],
  ['POST /api/agent-threads/1/follow-up', () => ({ status: 202, body: { started: true } })],
  ['POST /api/agent-threads/1/interrupt', () => ({ status: 202, body: { interrupted: true } })],
  ['POST /api/agent-threads/1/retry', () => ({ status: 202, body: { started: true } })],
  ['POST /api/agent-threads/1/input', () => ({ status: 200, body: { accepted: true } })],
  ['POST /api/work-items', (body) => ({ status: 201, body: { id: 2, key: 'W-0002', title: String(body?.title || 'Fixture Work') } })],
  ['POST /api/work-items/2/threads', () => ({ status: 202, body: { status: 'started', execution_mode: 'direct', workspace_mode: 'work_item', threads: [{ id: 2, repo_id: 1, full_name: 'vertexade/fixture' }], errors: [] } })],
  [
    'GET /api/agent/options',
    () => ({
      status: 200,
      body: {
        agent: { id: 'codex' },
        agents: [{ id: 'codex', name: 'Codex', enabled: true, selectable: true }],
        models: [{ id: 'gpt-5.6', name: 'GPT-5.6', reasoning_efforts: [{ id: 'high' }] }],
      },
    }),
  ],
  [`GET ${settingsPath}`, () => ({ status: 200, body: { configured: true, label: 'Device smoke fixture' } })],
  [`POST ${settingsPath}`, (body) => ({ status: 200, body: { configured: true, label: String(body?.label || '') } })],
  [`DELETE ${settingsPath}`, () => ({ status: 200, body: { configured: false, label: 'Device smoke fixture' } })],
])

export function fixtureResponse(method, pathname, body) {
  const handler = fixedRoutes.get(`${method} ${pathname}`)
  if (handler) return handler(body)
  if (method === 'GET' && pathname in collections) return { status: 200, body: collections[pathname] }
  return { status: 404, body: { error: `No fixture route for ${method} ${pathname}` } }
}

async function requestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (!chunks.length) return undefined
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function startFixtureServer(environment = process.env) {
  const host = environment.MOBILE_FIXTURE_HOST || '127.0.0.1'
  const port = Number(environment.MOBILE_FIXTURE_PORT || 4199)
  const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const logPath = resolve(environment.MOBILE_FIXTURE_LOG || `${appDirectory}/../../artifacts/mobile-device/fixture-requests.jsonl`)
  await mkdir(dirname(logPath), { recursive: true })

  const server = createServer(async (request, response) => {
    const startedAt = new Date().toISOString()
    const method = request.method || 'GET'
    const pathname = new URL(request.url || '/', `http://${request.headers.host || 'fixture'}`).pathname
    const body = await requestBody(request)
    const result = fixtureResponse(method, pathname, body)
    await appendFile(logPath, `${JSON.stringify({ at: startedAt, method, pathname, body, status: result.status })}\n`)
    response.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(result.body))
  })

  await new Promise((resolvePromise) => server.listen(port, host, resolvePromise))
  process.stdout.write(`Mobile fixture listening on http://${host}:${port}\n`)
  return server
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startFixtureServer()
  const close = () => server.close(() => process.exit(0))
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
}

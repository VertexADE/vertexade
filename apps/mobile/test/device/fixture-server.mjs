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
const fixedRoutes = new Map([
  ['GET /health', () => ({ status: 200, body: { ok: true } })],
  ['GET /api/modules', () => ({ status: 200, body: moduleCatalog })],
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

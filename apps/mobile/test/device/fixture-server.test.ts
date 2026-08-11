import { spawn, type ChildProcess } from 'node:child_process'
import { request } from 'node:http'
import { resolve } from 'node:path'

const port = 4299
const baseUrl = `http://127.0.0.1:${port}`
let fixture: ChildProcess

function fixtureRequest(pathname: string, method = 'GET', body?: unknown) {
  return new Promise<{ status: number; body: unknown }>((resolvePromise, rejectPromise) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const outgoing = request(`${baseUrl}${pathname}`, {
      method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : undefined,
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolvePromise({
        status: response.statusCode || 0,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }))
    })
    outgoing.on('error', rejectPromise)
    if (payload) outgoing.write(payload)
    outgoing.end()
  })
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fixtureRequest('/health')).status === 200) return
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  throw new Error('Mobile fixture did not become ready')
}

beforeAll(async () => {
  fixture = spawn(process.execPath, [resolve(__dirname, 'fixture-server.mjs')], {
    env: { ...process.env, MOBILE_FIXTURE_PORT: String(port), MOBILE_FIXTURE_LOG: '/tmp/vertexade-mobile-fixture-test.jsonl' },
    stdio: 'ignore',
  })
  await waitUntilReady()
})

afterAll(() => fixture.kill('SIGTERM'))

describe('mobile device fixture', () => {
  test('publishes itself through the port 4173 backend discovery contract', async () => {
    await expect(fixtureRequest('/api/backends').then((response) => response.body)).resolves.toEqual({
      backends: [expect.objectContaining({ id: 'fixture', label: 'Fixture server', isDefault: true, connected: true })],
    })
  })

  test('publishes the complete smoke catalog', async () => {
    const catalog = (await fixtureRequest('/api/modules')).body as {
      modules: Array<{ id: string; enabled: boolean; portable: { settings?: unknown } }>
    }
    expect(catalog.modules.map((module) => module.id)).toEqual(['work', 'agents', 'pull-requests', 'settings'])
    expect(catalog.modules.find((module) => module.id === 'settings')).toMatchObject({
      enabled: false,
      portable: { settings: expect.any(Object) },
    })
  })

  test('serves collection, agent, and settings states without production data', async () => {
    await expect(fixtureRequest('/api/extensions/work/work').then((response) => response.body)).resolves.toMatchObject({
      items: [{ id: 'work-1' }],
    })
    await expect(fixtureRequest('/api/agent/options').then((response) => response.body)).resolves.toMatchObject({
      agent: { id: 'codex' },
    })
    const saved = await fixtureRequest('/api/extensions/settings/settings', 'POST', { label: 'Changed' })
    expect(saved.body).toEqual({ configured: true, label: 'Changed' })
  })

  test('serves the native workspace and deterministic creation lifecycle', async () => {
    const readModel = (await fixtureRequest('/api/read-model?since=0')).body as {
      updates: Record<string, { entries: Array<{ value: Record<string, unknown> }> }>
    }
    expect(readModel.updates.pullRequests.entries[0]?.value).toMatchObject({ number: 299, title: 'Improve release quality' })
    expect(readModel.updates.workItems.entries[0]?.value).toMatchObject({ key: 'W-0001' })
    expect(readModel.updates.agentThreads.entries[0]?.value).toMatchObject({ status: 'running' })

    const created = await fixtureRequest('/api/work-items', 'POST', { title: 'Device smoke draft PR' })
    expect(created).toMatchObject({ status: 201, body: { id: 2, key: 'W-0002', title: 'Device smoke draft PR' } })
    const started = await fixtureRequest('/api/work-items/2/threads', 'POST', { repository_ids: [1], create_pr: true })
    expect(started).toMatchObject({ status: 202, body: { status: 'started', errors: [] } })
  })

  test('serves full PR, Work, and thread details with core actions', async () => {
    await expect(fixtureRequest('/api/pulls/1/299/details').then((response) => response.body)).resolves.toMatchObject({
      title: 'Improve release quality',
      changedFiles: 3,
      statusCheckRollup: [{ name: 'mobile-check', conclusion: 'SUCCESS' }],
    })
    await expect(fixtureRequest('/api/work-items/1').then((response) => response.body)).resolves.toMatchObject({
      key: 'W-0001',
      threads: [{ id: 1 }],
      events: [{ event_type: 'thread_started' }],
    })
    await expect(fixtureRequest('/api/agent-threads/1/log').then((response) => response.body)).resolves.toMatchObject({
      thread_id: 'fixture-thread-1',
      events: [{ title: 'Verification' }],
    })
    await expect(fixtureRequest('/api/agent-threads/1/diff').then((response) => response.body)).resolves.toMatchObject({
      diff_summary: { additions: 84, deletions: 12 },
    })
    await expect(fixtureRequest('/api/work-items/1', 'PATCH', { state: 'review' }).then((response) => response.body)).resolves.toMatchObject({ state: 'review' })
    await expect(fixtureRequest('/api/agent-threads/1/queue', 'POST', { prompt: 'Continue' })).resolves.toMatchObject({ status: 202, body: { queued: true } })
  })

  test('fails closed for undeclared fixture routes', async () => {
    const response = await fixtureRequest('/api/production-data', 'DELETE')
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: 'No fixture route for DELETE /api/production-data' })
  })
})

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

  test('fails closed for undeclared fixture routes', async () => {
    const response = await fixtureRequest('/api/production-data', 'DELETE')
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: 'No fixture route for DELETE /api/production-data' })
  })
})

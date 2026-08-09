import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { request } from 'node:http'
import { afterAll, describe, expect, it } from 'vite-plus/test'
import { drizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { runCommand } from '../process.ts'
import { WorktreePreviewRuntime } from './runtime.ts'
import { WorktreePreviewGateway } from './gateway.ts'

const dockerTests = process.env.RUN_DOCKER_PREVIEW_TESTS === '1'
const directories: string[] = []

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

afterAll(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

describe.skipIf(!dockerTests)('worktree preview Docker integration', () => {
  it('builds a detected Dockerfile, injects PORT, publishes it, and removes the container', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vertexade-preview-docker-'))
    const data = await mkdtemp(join(tmpdir(), 'vertexade-preview-data-'))
    directories.push(root, data)
    await writeFile(
      join(root, 'Dockerfile'),
      `FROM alpine:3.20
RUN apk add --no-cache busybox-extras
EXPOSE 8080
CMD ["sh", "-c", "mkdir -p /www && echo $PORT > /www/index.html && httpd -f -p $PORT -h /www"]
`,
    )
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE worktree_previews (
      job_id INTEGER PRIMARY KEY, status TEXT NOT NULL, manifest TEXT, error TEXT, progress TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT, stopped_at TEXT
    )`)
    const gatewayPort = await availablePort()
    const settings = { domain: 'preview.localhost', gatewayPort }
    const commands: Array<{ command: string; args: string[] }> = []
    const run = async (command: string, args: string[], options?: Record<string, unknown>) => {
      commands.push({ command, args })
      return runCommand(command, args, options)
    }
    const runtime = new WorktreePreviewRuntime({
      db: drizzleDashboardDatabase(db),
      dataDirectory: data,
      run,
      settings: () => settings,
      environment: () => ({
        repository: 'vertexade/platform',
        scope: '',
        variables: { RESPONSE: '{{domain}}|{{url}}|{{port}}' },
        startCommand: 'mkdir -p /www && echo "$RESPONSE" > /www/index.html && httpd -f -p "$PORT" -h /www',
        stopCommand: 'echo container-stop-complete',
      }),
    })

    runtime.start({ id: 901_001, repo_id: 7, worktree_path: root })
    let preview = runtime.get(901_001)
    for (let attempt = 0; attempt < 120 && preview.status === 'starting'; attempt += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 500)
      })
      preview = runtime.get(901_001)
    }

    expect(preview.error).toBeNull()
    expect(preview.status).toBe('running')
    const service = preview.manifest!.services[0]
    const port = service.ports.find((candidate) => candidate.protocol === 'tcp')!
    const expectedBody = `app-901001.preview.localhost|http://app-901001.preview.localhost:${gatewayPort}|8080\n`
    expect(await fetch(`http://127.0.0.1:${port.hostPort}`).then((response) => response.text())).toBe(expectedBody)
    const gateway = new WorktreePreviewGateway()
    let gatewayBody = ''
    try {
      await gateway.configure(settings, (hostname) => (hostname === port.hostname ? { hostPort: port.hostPort } : null))
      gatewayBody = await new Promise<string>((resolve, reject) => {
        const outgoing = request({ hostname: '127.0.0.1', port: gatewayPort, headers: { host: port.hostname } }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        })
        outgoing.on('error', reject)
        outgoing.end()
      })
    } finally {
      await gateway.stop()
      await runtime.stopAndWait(901_001)
    }
    expect(gatewayBody).toBe(expectedBody)
    expect(runtime.get(901_001).status).toBe('stopped')
    await expect(runCommand('docker', ['inspect', service.containerId], { timeoutMs: 10_000 })).rejects.toThrow()
    expect(commands).toContainEqual({
      command: 'docker',
      args: ['exec', service.containerId, 'sh', '-lc', 'echo container-stop-complete'],
    })
  }, 120_000)

  it('starts every Tilt-referenced Compose service on an isolated random port', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vertexade-preview-compose-'))
    const data = await mkdtemp(join(tmpdir(), 'vertexade-preview-data-'))
    directories.push(root, data)
    await mkdir(join(root, 'infra'))
    await writeFile(join(root, 'Tiltfile'), "docker_compose('infra/compose.yaml')\n")
    await writeFile(join(root, 'infra/fixture.txt'), 'nested-bind\n')
    await writeFile(
      join(root, 'Dockerfile'),
      `FROM alpine:3.20
RUN apk add --no-cache busybox-extras
EXPOSE 8080
CMD ["sh", "-c", "mkdir -p /www && echo $PORT > /www/index.html && httpd -f -p $PORT -h /www"]
`,
    )
    await writeFile(
      join(root, 'infra/compose.yaml'),
      `services:
  api:
    build: ..
    ports:
      - "8080"
    volumes:
      - ./fixture.txt:/fixture.txt:ro
    command: ["sh", "-c", "mkdir -p /www && cat /fixture.txt > /www/index.html && httpd -f -p $$PORT -h /www"]
  admin:
    build: ..
    ports:
      - "9090"
`,
    )
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE worktree_previews (
      job_id INTEGER PRIMARY KEY, status TEXT NOT NULL, manifest TEXT, error TEXT, progress TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT, stopped_at TEXT
    )`)
    const runtime = new WorktreePreviewRuntime({
      db: drizzleDashboardDatabase(db),
      dataDirectory: data,
      run: runCommand,
      settings: () => ({ domain: 'preview.localhost', gatewayPort: 4180 }),
    })

    runtime.start({ id: 901_002, worktree_path: root })
    let preview = runtime.get(901_002)
    for (let attempt = 0; attempt < 120 && preview.status === 'starting'; attempt += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 500)
      })
      preview = runtime.get(901_002)
    }
    try {
      expect(preview.error).toBeNull()
      expect(preview.status).toBe('running')
      expect(preview.manifest?.source).toBe('tilt-compose')
      expect(preview.manifest?.services.map((service) => service.name).sort()).toEqual(['admin', 'api'])
      const responses = await Promise.all(
        preview.manifest!.services.map((service) => {
          const port = service.ports.find((candidate) => candidate.protocol === 'tcp')!
          return fetch(`http://127.0.0.1:${port.hostPort}`).then((response) => response.text())
        }),
      )
      expect(responses.sort()).toEqual(['9090\n', 'nested-bind\n'])
    } finally {
      await runtime.stopAndWait(901_002)
    }
    expect(runtime.get(901_002).status).toBe('stopped')
  }, 120_000)
})

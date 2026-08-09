import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { detectWorktreePreview } from './detect.ts'

const directories: string[] = []

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'vertexade-preview-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('detectWorktreePreview', () => {
  it('uses Tilt docker_build declarations without executing the Tiltfile', async () => {
    const root = await workspace()
    await writeFile(join(root, 'Tiltfile'), "docker_build('example/api', '.')\nlocal_resource('unsafe', 'touch /tmp/never')\n")
    await writeFile(join(root, 'Dockerfile'), 'FROM node:22-alpine\nENV PORT=4310\nEXPOSE 4310\n')
    const run = vi.fn()

    const plan = await detectWorktreePreview(root, run)

    expect(run).not.toHaveBeenCalled()
    expect(plan.source).toBe('tilt-dockerfile')
    expect(plan.services).toEqual([
      expect.objectContaining({
        name: 'api',
        runtimeName: 'api',
        ports: [{ containerPort: 4310, protocol: 'tcp' }],
      }),
    ])
  })

  it('follows a Tilt docker_compose reference and discovers every service port', async () => {
    const root = await workspace()
    await writeFile(join(root, 'Tiltfile'), "docker_compose('infra/dev.compose.yaml')\n")
    await mkdir(join(root, 'infra'))
    await writeFile(join(root, 'infra/dev.compose.yaml'), 'services: {}\n')
    const run = vi.fn(async () =>
      JSON.stringify({
        services: {
          api: { build: { context: root }, ports: [{ target: 3000, protocol: 'tcp' }] },
          worker: { image: 'example/worker', environment: { PORT: '4100' } },
        },
      }),
    )

    const plan = await detectWorktreePreview(root, run)

    expect(plan.source).toBe('tilt-compose')
    expect(plan.services.map((service) => [service.name, service.ports[0]?.containerPort])).toEqual([
      ['api', 3000],
      ['worker', 4100],
    ])
    expect(run).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['compose', '--project-directory', join(root, 'infra'), 'config', '--format', 'json']),
      expect.objectContaining({ cwd: join(root, 'infra') }),
    )
  })

  it('scans nested Dockerfiles while ignoring generated dependency folders', async () => {
    const root = await workspace()
    await mkdir(join(root, 'services/api'), { recursive: true })
    await mkdir(join(root, 'node_modules/ignored'), { recursive: true })
    await writeFile(join(root, 'services/api/Dockerfile'), 'FROM scratch\nEXPOSE 8080 8443\n')
    await writeFile(join(root, 'node_modules/ignored/Dockerfile'), 'FROM scratch\nEXPOSE 9999\n')

    const plan = await detectWorktreePreview(root, vi.fn())

    expect(plan.source).toBe('dockerfile')
    expect(plan.services).toHaveLength(1)
    expect(plan.services[0].ports.map((port) => port.containerPort)).toEqual([8080, 8443])
  })

  it('rejects Compose build contexts outside the worktree', async () => {
    const root = await workspace()
    await writeFile(join(root, 'compose.yaml'), 'services: {}\n')
    const run = vi.fn(async () =>
      JSON.stringify({
        services: { api: { build: { context: '..' }, ports: [{ target: 3000 }] } },
      }),
    )

    await expect(detectWorktreePreview(root, run)).rejects.toThrow('builds outside the worktree')
  })

  it('reports repository tools while preserving explicit container definitions', async () => {
    const root = await workspace()
    await mkdir(join(root, '.moon'))
    await writeFile(join(root, '.moon/workspace.yml'), 'projects: {}\n')
    await writeFile(join(root, 'mise.toml'), '[tools]\nnode = "22.15.0"\n"npm:@moonrepo/cli" = "1.40.4"\n"npm:pnpm" = "10.7.0"\n')
    await writeFile(join(root, 'package.json'), '{"packageManager":"pnpm@10.8.0"}\n')
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    await writeFile(join(root, 'Dockerfile'), 'FROM scratch\nEXPOSE 8080\n')

    const plan = await detectWorktreePreview(root, vi.fn())

    expect(plan.source).toBe('dockerfile')
    expect(plan.tools).toEqual([
      expect.objectContaining({ id: 'moon', version: '1.40.4' }),
      expect.objectContaining({ id: 'mise' }),
      expect.objectContaining({ id: 'node', version: '22.15.0' }),
      expect.objectContaining({ id: 'pnpm', version: '10.8.0' }),
    ])
  })

  it('creates a Moon project plan only when no container definition exists', async () => {
    const root = await workspace()
    await mkdir(join(root, '.moon'))
    await mkdir(join(root, 'apps/web'), { recursive: true })
    await writeFile(join(root, '.moon/workspace.yml'), "projects:\n  '@apps/web': apps/web\n")
    await writeFile(join(root, 'apps/web/moon.yml'), "tasks:\n  dev:\n    command: 'vite --port 4173'\n")

    const plan = await detectWorktreePreview(root, vi.fn())

    expect(plan.source).toBe('moon')
    expect(plan.sourceFile).toBe(join(root, '.moon/workspace.yml'))
    expect(plan.services).toEqual([
      expect.objectContaining({
        source: 'moon',
        project: '@apps/web',
        task: 'dev',
        ports: [{ containerPort: 4173, protocol: 'tcp' }],
      }),
    ])
  })

  it('detects a dependency-aware Moon environment from tool Compose stacks and application Dockerfiles', async () => {
    const root = await workspace()
    await mkdir(join(root, '.moon'))
    await mkdir(join(root, 'devtools/database'), { recursive: true })
    await mkdir(join(root, 'services/api'), { recursive: true })
    await mkdir(join(root, 'services/feedback-service'), { recursive: true })
    await writeFile(
      join(root, '.moon/workspace.yml'),
      [
        'projects:',
        "  '@devtools/database': devtools/database",
        "  '@services/api': services/api",
        "  '@services/feedback-service': services/feedback-service",
        '',
      ].join('\n'),
    )
    await writeFile(
      join(root, 'devtools/database/moon.yml'),
      ["layer: 'tool'", 'tasks:', '  pre-dev:', "    command: 'docker compose -f docker-compose.yml up --wait'", ''].join('\n'),
    )
    await writeFile(join(root, 'devtools/database/docker-compose.yml'), 'services: {}\n')
    await writeFile(
      join(root, 'services/api/moon.yml'),
      ["layer: 'application'", "stack: 'backend'", 'dependsOn:', "  - id: '@devtools/database'", "    scope: 'development'", ''].join('\n'),
    )
    await writeFile(join(root, 'services/api/Dockerfile'), 'FROM scratch\nCOPY --from=workspace . .\nEXPOSE 3000\n')
    await writeFile(join(root, 'services/api/.env.local'), 'PORT=4300\nDB_HOST=localhost\nDB_PORT=15432\n')
    await writeFile(join(root, 'services/feedback-service/moon.yml'), ["layer: 'application'", "stack: 'backend'", ''].join('\n'))
    await writeFile(join(root, 'services/feedback-service/Dockerfile'), 'FROM scratch\nCOPY --from=workspace . .\nEXPOSE 3000\n')
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === 'git') return 'services/api/.env.local\0'
      expect(args).toContain(join(root, 'devtools/database/docker-compose.yml'))
      return JSON.stringify({
        services: {
          database: {
            image: 'postgres:18',
            ports: [{ target: 5432, published: 15432 }],
            healthcheck: { test: ['CMD', 'true'] },
          },
        },
      })
    })

    const plan = await detectWorktreePreview(root, run)

    expect(plan.source).toBe('moon-compose')
    expect(plan.services.map((service) => service.name)).toEqual(['database', 'services-api', 'services-feedback-service'])
    expect(plan.services[0].ports).toEqual([{ containerPort: 5432, protocol: 'tcp', public: false }])
    expect(plan.compose?.services['services-api']).toMatchObject({
      build: {
        context: join(root, 'services/api'),
        dockerfile: join(root, 'services/api/Dockerfile'),
        additional_contexts: { workspace: root },
      },
      environment: { PORT: '4300', DB_HOST: 'database', DB_PORT: '15432' },
      depends_on: { database: { condition: 'service_healthy' } },
      networks: ['default'],
    })
  })

  it('keeps an explicit root Compose file ahead of inferred Moon orchestration', async () => {
    const root = await workspace()
    await mkdir(join(root, '.moon'))
    await writeFile(join(root, '.moon/workspace.yml'), 'projects: {}\n')
    await writeFile(join(root, 'compose.yaml'), 'services: {}\n')
    const run = vi.fn(async () => JSON.stringify({ services: { web: { image: 'example/web', ports: [{ target: 8080 }] } } }))

    const plan = await detectWorktreePreview(root, run)

    expect(plan.source).toBe('compose')
    expect(plan.services[0].name).toBe('web')
    expect(run).toHaveBeenCalledTimes(1)
  })
})

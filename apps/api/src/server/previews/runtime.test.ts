import { describe, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compactPreviewError,
  degradedPreviewPlan,
  isolatedCompose,
  moonPreviewDockerfile,
  normalizePreviewSettings,
  previewPublishedPort,
  stagePreviewBindMounts,
  unavailablePreviewServices,
  WorktreePreviewRuntime,
} from './runtime.ts'
import type { PreviewPlan } from './detect.ts'
import { openDashboardDatabase } from '../database/dashboard-database.ts'

function plan(service: Record<string, unknown> = {}): PreviewPlan {
  return {
    source: 'compose',
    sourceFile: '/worktree/compose.yaml',
    tools: [],
    warnings: [],
    services: [
      {
        name: 'api',
        runtimeName: 'api',
        source: 'compose',
        ports: [{ containerPort: 3000, protocol: 'tcp' }],
      },
    ],
    compose: { services: { api: service } },
  }
}

describe('worktree preview runtime', () => {
  it('does not reopen stopped preview manifests whose generated files are already gone', async () => {
    const db = openDashboardDatabase(':memory:')
    db.$client.exec(`
      INSERT INTO repositories (id,full_name,clone_url,local_path) VALUES (1,'example/repo','ssh://example/repo','/repos/example');
      INSERT INTO work_items (id,key,title,kind,state,primary_repository_id)
        VALUES (1,'W-0001','Preview','implementation','done',1);
      INSERT INTO jobs (id,repo_id,pr_number,prompt,worktree_path,log_path,status,work_item_id)
        VALUES (52,1,0,'preview','/worktrees/example','/logs/52.log','completed',1);
      INSERT INTO worktree_previews (job_id,status,manifest)
        VALUES (52,'stopped','{"projectName":"vertexade-preview-52","composeFile":"/data/worktree-previews/vertexade-preview-52.json","services":[]}');
    `)
    const run = vi.fn(async () => {
      throw new Error('stopped previews must not call Docker')
    })
    const runtime = new WorktreePreviewRuntime({
      db,
      dataDirectory: '/data',
      run,
      settings: () => ({ domain: 'preview.example.com', gatewayPort: 4180 }),
    })

    await expect(runtime.stopAndWait(52)).resolves.toBeUndefined()
    expect(run).not.toHaveBeenCalled()
  })

  it('reports a detected TCP service that did not reach a published running state', () => {
    const previewPlan = plan()
    const unavailable = unavailablePreviewServices(previewPlan, [
      {
        name: 'api',
        containerId: 'container-1',
        containerName: 'api',
        status: 'restarting',
        ports: [],
      },
    ])

    expect(unavailable.map((service) => service.name)).toEqual(['api'])
  })

  it('normalizes wildcard domains and validates the public gateway port', () => {
    expect(normalizePreviewSettings({ domain: '*.Preview.Example.com.', gatewayPort: 4810 })).toEqual({
      domain: 'preview.example.com',
      gatewayPort: 4810,
    })
    expect(() => normalizePreviewSettings({ domain: 'https://preview.example.com/path' })).toThrow('hostname')
    expect(() => normalizePreviewSettings({ gatewayPort: 80 })).toThrow('1024')
  })

  it('gives services stable wildcard hostnames', () => {
    expect(previewPublishedPort({ domain: 'preview.example.com', gatewayPort: 4180 }, 'Web API', 42, 3000, 49152, 'tcp', false)).toEqual({
      containerPort: 3000,
      hostPort: 49152,
      protocol: 'tcp',
      hostname: 'web-api-42.preview.example.com',
      url: 'http://web-api-42.preview.example.com:4180',
    })
    expect(
      previewPublishedPort({ domain: 'preview.example.com', gatewayPort: 4180 }, 'Database', 42, 5432, 49153, 'tcp', false, false),
    ).toMatchObject({ hostname: '', url: null })
  })

  it('isolates Compose services, replaces public ports, and always injects PORT', () => {
    const compose = isolatedCompose(
      plan({
        container_name: 'fixed-name',
        environment: { EXISTING: 'yes', PORT: '9999' },
        ports: [{ target: 3000, published: 3000 }],
      }),
      '/worktree',
      42,
    )

    expect(compose.services.api.container_name).toBeUndefined()
    expect(compose.services.api.environment).toEqual({ EXISTING: 'yes', PORT: '3000' })
    expect(compose.services.api.ports).toEqual([{ target: 3000, protocol: 'tcp', host_ip: '127.0.0.1', mode: 'ingress' }])
    expect(compose.services.api.labels).toMatchObject({
      'vertexade.preview': 'true',
      'vertexade.preview.job': '42',
    })
  })

  it('restarts generated application services while dependencies finish initializing', () => {
    const previewPlan = plan({})
    previewPlan.services[0].source = 'dockerfile'

    const compose = isolatedCompose(previewPlan, '/worktree', 42)

    expect(compose.services.api.restart).toBe('on-failure:5')
  })

  it('rejects privileged services and host bind mounts outside the worktree', () => {
    expect(() => isolatedCompose(plan({ privileged: true }), '/worktree', 1)).toThrow('privileged')
    expect(() => isolatedCompose(plan({ volumes: [{ type: 'bind', source: '/etc', target: '/host' }] }), '/worktree', 1)).toThrow(
      'outside the worktree',
    )
  })

  it('rejects named build contexts outside the worktree', () => {
    expect(() =>
      isolatedCompose(
        plan({
          build: { context: '/worktree/app', additional_contexts: { workspace: '/outside' } },
        }),
        '/worktree',
        1,
      ),
    ).toThrow('build context outside the worktree')
  })

  it('resolves browser-facing service references to stable preview URLs', () => {
    const previewPlan = plan({ environment: { API_URL: 'vertexade-preview://api/3000/v1' } })
    const compose = isolatedCompose(previewPlan, '/worktree', 42, {
      domain: 'preview.example.com',
      gatewayPort: 4180,
    })

    expect(compose.services.api.environment.API_URL).toBe('http://api-42.preview.example.com:4180/v1')
  })

  it('stages read-only bind mounts with container-readable permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vertexade-bind-'))
    const assets = await mkdtemp(join(tmpdir(), 'vertexade-assets-'))
    try {
      await mkdir(join(root, 'config'), { mode: 0o700 })
      await writeFile(join(root, 'config', 'init.sql'), 'SELECT 1\n', { mode: 0o600 })
      const previewPlan = plan({
        volumes: [{ type: 'bind', source: join(root, 'config'), target: '/config', read_only: true }],
      })

      const staged = await stagePreviewBindMounts(previewPlan, root, assets)
      const source = staged.compose?.services.api.volumes[0].source

      expect(source).not.toBe(join(root, 'config'))
      expect((await stat(source)).mode & 0o777).toBe(0o755)
      expect(await readFile(join(source, 'init.sql'), 'utf8')).toBe('SELECT 1\n')
      expect((await stat(join(source, 'init.sql'))).mode & 0o777).toBe(0o644)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(assets, { recursive: true, force: true })
    }
  })

  it('degrades an unavailable dependency subtree while preserving independent web services', () => {
    const previewPlan: PreviewPlan = {
      source: 'moon-compose',
      sourceFile: '/worktree/.moon/workspace.yml',
      tools: [],
      warnings: [],
      services: [
        {
          name: 'database',
          runtimeName: 'database',
          source: 'compose',
          ports: [{ containerPort: 5432, protocol: 'tcp', public: false }],
        },
        {
          name: 'dependent-api',
          runtimeName: 'dependent-api',
          source: 'dockerfile',
          ports: [{ containerPort: 3000, protocol: 'tcp' }],
        },
        {
          name: 'portal',
          runtimeName: 'portal',
          source: 'dockerfile',
          ports: [{ containerPort: 8080, protocol: 'tcp' }],
        },
      ],
      compose: {
        services: {
          database: {},
          'dependent-api': { depends_on: { database: { condition: 'service_healthy' } } },
          portal: {},
        },
      },
    }

    const degraded = degradedPreviewPlan(previewPlan, ['database'])

    expect(degraded?.services.map((service) => service.name)).toEqual(['portal'])
    expect(Object.keys(degraded?.compose?.services || {})).toEqual(['portal'])
    expect(degraded?.warnings[0]).toContain('database, dependent-api')
  })

  it('compacts verbose Docker output to actionable failure lines', () => {
    expect(compactPreviewError('Downloading 500MB\ncontainer postgres is unhealthy\nmore noise')).toBe('container postgres is unhealthy')
  })

  it('generates a self-contained Moon Docker build without a host worktree mount', () => {
    const previewPlan: PreviewPlan = {
      source: 'moon',
      sourceFile: '/worktree/.moon/workspace.yml',
      warnings: [],
      tools: [
        {
          id: 'moon',
          name: 'Moon',
          sourceFile: '/worktree/.moon/workspace.yml',
          version: '1.40.4',
        },
        { id: 'node', name: 'Node.js', sourceFile: '/worktree/mise.toml', version: '22.15.0' },
      ],
      services: [
        {
          name: 'apps-web',
          runtimeName: '@apps/web',
          source: 'moon',
          context: '/worktree',
          project: '@apps/web',
          task: 'dev',
          ports: [{ containerPort: 4173, protocol: 'tcp' }],
        },
      ],
    }

    const dockerfile = moonPreviewDockerfile(previewPlan, previewPlan.services[0])

    expect(dockerfile).toContain('moonrepo/cli@1.40.4')
    expect(dockerfile).toContain('FROM node:22.15.0-bookworm-slim AS scaffold')
    expect(dockerfile).toContain('["rm","-rf",".git",".moon/cache"]')
    expect(dockerfile).toContain('["moon","docker","scaffold","@apps/web"]')
    expect(dockerfile).toContain('["moon","docker","setup"]')
    expect(dockerfile).toContain('["moon","run","@apps/web:dev"]')
    expect(dockerfile).not.toContain('VOLUME')
  })
})

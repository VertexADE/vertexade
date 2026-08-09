import { describe, expect, it, vi } from 'vite-plus/test'
import type { PreviewPlan } from './detect.ts'
import {
  applyEnvironmentToCompose,
  previewServiceEnvironments,
  resolveEnvironmentTemplate,
  runContainerStopCommands,
} from './environment.ts'

function plan(): PreviewPlan {
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
        context: '/worktree/apps/api',
        ports: [{ containerPort: 3000, protocol: 'tcp' }],
      },
    ],
    compose: { services: { api: { environment: { EXISTING: 'kept' } } } },
  }
}

describe('preview repository environments', () => {
  it('resolves service-specific placeholders and injects compose values', () => {
    const previewPlan = plan()
    const environments = previewServiceEnvironments({
      baseDomain: 'previews.example.com',
      jobId: 42,
      plan: previewPlan,
      repositoryId: 7,
      resolve: (repositoryId, targetPath) => {
        expect([repositoryId, targetPath]).toEqual([7, 'apps/api'])
        return {
          repository: 'vertexade/platform',
          scope: 'apps/api',
          variables: { PUBLIC_URL: 'https://{{domain}}', TASK: '{{repo}}:{{scope}}:{{job_id}}' },
          startCommand: 'serve --port {{port}} --url {{url}}',
          stopCommand: 'cleanup {{service}}',
        }
      },
      serviceAddress: () => ({
        domain: 'api-42.previews.example.com',
        url: 'http://api-42.previews.example.com:4180',
      }),
      worktree: '/worktree',
    })
    applyEnvironmentToCompose(previewPlan, environments)
    expect(previewPlan.compose?.services.api).toEqual({
      environment: {
        EXISTING: 'kept',
        PUBLIC_URL: 'https://api-42.previews.example.com',
        TASK: 'vertexade/platform:apps/api:42',
      },
      entrypoint: ['sh', '-lc'],
      command: ['serve --port 3000 --url http://api-42.previews.example.com:4180'],
    })
    expect(environments.get('api')?.stopCommand).toBe('cleanup api')
  })

  it('leaves unsupported template syntax unchanged', () => {
    expect(
      resolveEnvironmentTemplate('{{domain}}:${OTHER}', {
        baseDomain: 'preview.test',
        domain: 'api.preview.test',
        jobId: 1,
        port: 3000,
        repository: 'owner/repo',
        scope: '',
        service: 'api',
        url: 'http://api.preview.test',
        worktree: 'repo-task',
      }),
    ).toBe('api.preview.test:${OTHER}')
  })

  it('runs stop commands inside their containers', async () => {
    const run = vi.fn(async () => '')
    await runContainerStopCommands([{ containerId: 'abc', stopCommand: 'npm run cleanup' }, { containerId: 'def' }], run)
    expect(run).toHaveBeenCalledWith(
      'docker',
      ['exec', 'abc', 'sh', '-lc', 'npm run cleanup'],
      expect.objectContaining({
        includeStderr: true,
      }),
    )
  })
})

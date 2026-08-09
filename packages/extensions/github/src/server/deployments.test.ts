import { describe, expect, it, vi } from 'vite-plus/test'
import { createGitHubDeploymentProvider } from './deployments.ts'

const workflowRun = {
  id: 42,
  head_sha: 'abcdef1234567890',
  display_title: 'Deploy availability service',
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-07-20T10:00:00Z',
  updated_at: '2026-07-20T10:05:00Z',
  html_url: 'https://github.com/acme/repo/actions/runs/42',
}

function job(environment: 'dev' | 'prd') {
  return {
    name: `Build and deploy service - availability-service / Deploy service -> ${environment}`,
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/acme/repo/actions/jobs/${environment}`,
    started_at: '2026-07-20T10:00:00Z',
    completed_at: '2026-07-20T10:05:00Z',
  }
}

describe('GitHub Actions deployment provider', () => {
  it('normalizes workflow jobs and caches the resulting snapshot', async () => {
    const run = vi.fn(async (_command: string, args: string[]) =>
      args.some((value) => value.endsWith('/jobs'))
        ? JSON.stringify({ jobs: [job('dev'), job('prd')] })
        : JSON.stringify({ workflow_runs: [workflowRun] }),
    )
    const provider = createGitHubDeploymentProvider(run)

    const first = await provider.overview()
    const second = await provider.overview()

    expect(first.services.find((service) => service.name === 'availability-service')).toMatchObject({
      state: 'deployed',
      environments: {
        dev: { deployed_sha: workflowRun.head_sha },
        prd: { deployed_sha: workflowRun.head_sha },
      },
    })
    expect(second).toBe(first)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('owns vendor-specific workflow rerun commands', async () => {
    const run = vi.fn(async () => '')
    const provider = createGitHubDeploymentProvider(run)
    await provider.rerun(42, 'failed')
    expect(run).toHaveBeenCalledWith('gh', ['api', '--method', 'POST', expect.stringContaining('/actions/runs/42/rerun-failed-jobs')])
  })
})

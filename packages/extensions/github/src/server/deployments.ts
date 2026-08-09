import type {
  DeploymentCommit,
  DeploymentProvider,
  DeploymentService,
  DeploymentSnapshot,
  DeploymentStage,
  ExtensionCacheServices,
} from '@vertexade/platform-contracts'
import type { CacheRefreshTrigger } from '@vertexade/platform-server/cache-trigger'

type RunCommand = (command: string, args: string[], options?: { input?: string }) => Promise<string>
type WorkflowRun = {
  id: number
  head_sha: string
  display_title: string
  status: string
  conclusion: string | null
  created_at: string
  updated_at: string
  html_url: string
}
type WorkflowJob = {
  name: string
  status: string
  conclusion: string | null
  html_url: string
  started_at: string | null
  completed_at: string | null
}
type InternalService = DeploymentService & { runs: DeploymentCommit[] }

const repository = process.env.DEPLOYMENT_REPOSITORY || 'vertexade/vertexade'
const workflow = process.env.DEPLOYMENT_WORKFLOW || 'monorepo.yml'
const defaultServices = (
  process.env.DEPLOYMENT_SERVICES ||
  ['availability-service', 'booking-service', 'master-data-service', 'site-access-service', 'tridens-integration', 'unified-api'].join(',')
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

function deploymentJob(job: WorkflowJob) {
  const match = String(job.name || '').match(/^Build and deploy service - ([^ /]+) \/ (.+)$/)
  if (!match) return null
  const deploy = match[2].match(/^Deploy [^ ]+ -> (dev|acc|prd)(?: \/|$)/)
  const stage =
    deploy?.[1] ||
    (match[2].startsWith('Build ')
      ? 'build'
      : match[2].startsWith('Acceptance tests')
        ? 'acceptance'
        : match[2].startsWith('Performance tests')
          ? 'performance'
          : 'other')
  return { service: match[1], stage }
}

function publicSummary(services: InternalService[]) {
  return {
    deployed: services.filter((service) => service.state === 'deployed').length,
    attention: services.filter((service) => ['failed', 'pending', 'outdated'].includes(service.state)).length,
    active: services.filter((service) => ['deploying', 'waiting'].includes(service.state)).length,
    pending_commits: services.reduce((count, service) => count + service.pending_commits.length, 0),
  }
}

export function createGitHubDeploymentProvider(
  run: RunCommand,
  cache?: ExtensionCacheServices,
  refreshTrigger?: CacheRefreshTrigger,
): DeploymentProvider {
  let fallbackCache: { at: number; value: DeploymentSnapshot | null } = { at: 0, value: null }
  return {
    id: 'github-actions',
    name: 'GitHub Actions',
    async overview(refresh = false) {
      const loader = async () => {
        const runsResponse = JSON.parse(
          await run('gh', [
            'api',
            '--method',
            'GET',
            `repos/${repository}/actions/workflows/${workflow}/runs`,
            '-f',
            'branch=main',
            '-f',
            'event=push',
            '-f',
            'per_page=30',
          ]),
        ) as {
          workflow_runs?: WorkflowRun[]
        }
        const runs = runsResponse.workflow_runs || []
        const jobsByRun = await Promise.all(
          runs.map(async (workflowRun) => {
            const response = JSON.parse(
              await run('gh', ['api', '--method', 'GET', `repos/${repository}/actions/runs/${workflowRun.id}/jobs`, '-f', 'per_page=100']),
            ) as { jobs?: WorkflowJob[] }
            return [workflowRun.id, response.jobs || []] as const
          }),
        )
        const jobs = new Map<number, WorkflowJob[]>(jobsByRun)
        const serviceNames = new Set(defaultServices)
        for (const runJobs of jobs.values())
          for (const job of runJobs) {
            const parsed = deploymentJob(job)
            if (parsed) serviceNames.add(parsed.service)
          }

        const services: InternalService[] = [...serviceNames].sort().map((name) => {
          const affectedRuns = runs.flatMap((workflowRun) => {
            const serviceJobs = (jobs.get(workflowRun.id) || [])
              .map((job) => ({ job, parsed: deploymentJob(job) }))
              .filter((item): item is { job: WorkflowJob; parsed: { service: string; stage: string } } => item.parsed?.service === name)
            if (!serviceJobs.length) return []
            const stages = Object.fromEntries(
              serviceJobs.map(({ job, parsed }) => [
                parsed.stage,
                {
                  status: job.status,
                  conclusion: job.conclusion,
                  url: job.html_url,
                  started_at: job.started_at,
                  completed_at: job.completed_at,
                } satisfies DeploymentStage,
              ]),
            )
            return [
              {
                run_id: workflowRun.id,
                sha: workflowRun.head_sha,
                title: workflowRun.display_title,
                status: workflowRun.status,
                conclusion: workflowRun.conclusion,
                created_at: workflowRun.created_at,
                updated_at: workflowRun.updated_at,
                url: workflowRun.html_url,
                stages,
              } satisfies DeploymentCommit,
            ]
          })
          const environments = Object.fromEntries(
            (['dev', 'acc', 'prd'] as const).map((environment) => {
              const attempted = affectedRuns.find((item) => item.stages[environment])
              const deployed = affectedRuns.find((item) => item.stages[environment]?.conclusion === 'success')
              if (!attempted && !deployed) return [environment, null]
              return [
                environment,
                {
                  ...(attempted?.stages[environment] || deployed?.stages[environment]),
                  attempt_sha: attempted?.sha || null,
                  attempt_title: attempted?.title || null,
                  run_id: attempted?.run_id || deployed?.run_id,
                  deployed_sha: deployed?.sha || null,
                  deployed_title: deployed?.title || null,
                  deployed_at: deployed?.stages[environment]?.completed_at || null,
                },
              ]
            }),
          ) as Record<'dev' | 'acc' | 'prd', DeploymentStage | null>
          const productionIndex = affectedRuns.findIndex((item) => item.stages.prd?.conclusion === 'success')
          const pending = affectedRuns
            .slice(0, productionIndex < 0 ? affectedRuns.length : productionIndex)
            .filter((item) => item.stages.prd?.conclusion !== 'success')
          const latest = affectedRuns[0] || null
          const productionOutdated = Boolean(
            environments.dev?.deployed_sha &&
            environments.prd?.deployed_sha &&
            environments.dev.deployed_sha !== environments.prd.deployed_sha,
          )
          let state: DeploymentService['state'] = 'unknown'
          if (latest) {
            const stages = Object.values(latest.stages)
            if (stages.some((stage) => stage.conclusion === 'failure')) state = 'failed'
            else if (stages.some((stage) => stage.status === 'waiting')) state = 'waiting'
            else if (stages.some((stage) => ['queued', 'in_progress', 'pending', 'requested'].includes(stage.status))) state = 'deploying'
            else if (productionOutdated) state = 'outdated'
            else if (environments.prd?.deployed_sha) state = 'deployed'
            else state = 'pending'
          }
          const deploymentDelta = productionOutdated
            ? {
                from_sha: environments.prd!.deployed_sha!,
                to_sha: environments.dev!.deployed_sha!,
                commit_count: pending.length,
                compare_url: `https://github.com/${repository}/compare/${environments.prd!.deployed_sha}...${environments.dev!.deployed_sha}`,
              }
            : null
          return {
            name,
            state,
            latest,
            environments,
            production_outdated: productionOutdated,
            deployment_delta: deploymentDelta,
            pending_commits: pending,
            runs: affectedRuns,
          }
        })

        const value: DeploymentSnapshot = {
          repository,
          workflow,
          refreshed_at: new Date().toISOString(),
          services,
          summary: publicSummary(services),
        }
        refreshTrigger?.emitRefresh({
          force: refresh,
          provider: 'github-actions',
          key: 'deployments:overview',
          subject: `github:${repository}:deployments`,
          data: { count: services.length, repository },
        })
        return value
      }
      if (!cache) {
        if (!refresh && fallbackCache.value && Date.now() - fallbackCache.at < 30_000) return fallbackCache.value
        const value = await loader()
        fallbackCache = { at: Date.now(), value }
        return value
      }
      return (
        await cache.getOrLoad('deployments:overview', loader, {
          ttlMs: 30_000,
          staleWhileRevalidateMs: 120_000,
          tags: ['deployments'],
          forceRefresh: refresh,
        })
      ).value
    },
    async rerun(runId, mode) {
      await run('gh', [
        'api',
        '--method',
        'POST',
        `repos/${repository}/actions/runs/${runId}/${mode === 'failed' ? 'rerun-failed-jobs' : 'rerun'}`,
      ])
      cache?.invalidate({ tags: ['deployments'] })
      fallbackCache = { at: 0, value: null }
    },
  }
}

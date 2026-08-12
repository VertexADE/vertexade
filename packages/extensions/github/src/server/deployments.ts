import type {
  DeploymentCommit,
  DeploymentProvider,
  DeploymentService,
  DeploymentSnapshot,
  DeploymentStage,
  DeploymentTarget,
  ExtensionCacheServices,
} from '@vertexade/platform-contracts'
import type { CacheRefreshTrigger } from '@vertexade/platform-server/cache-trigger'
import {
  compileDeploymentJobMatcher,
  matchDeploymentJob,
  normalizeGitHubDeploymentTargets,
  type GitHubDeploymentTargetConfiguration,
} from './deployment-configuration.ts'

type RunCommand = (
  command: string,
  args: string[],
  options?: { input?: string; env?: Record<string, string | undefined> },
) => Promise<string>
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
type DeploymentConfiguration = () => GitHubDeploymentTargetConfiguration[]
type DeploymentJobParser = (name: string) => { service: string; environment: string } | null

function publicTarget(target: GitHubDeploymentTargetConfiguration): DeploymentTarget {
  return {
    id: target.id,
    label: target.label,
    repository: target.repository,
    workflow: target.workflow,
    branch: target.branch,
    event: target.event,
    environments: target.environments,
    production_environment: target.productionEnvironment,
    comparison_environment: target.comparisonEnvironment,
  }
}

function publicSummary(services: InternalService[]) {
  return {
    deployed: services.filter((service) => service.state === 'deployed').length,
    attention: services.filter((service) => ['failed', 'pending', 'outdated'].includes(service.state)).length,
    active: services.filter((service) => ['deploying', 'waiting'].includes(service.state)).length,
    pending_commits: services.reduce((count, service) => count + service.pending_commits.length, 0),
  }
}

function stage(job: WorkflowJob): DeploymentStage {
  return {
    status: job.status,
    conclusion: job.conclusion,
    url: job.html_url,
    started_at: job.started_at,
    completed_at: job.completed_at,
  }
}

function commitsForService(
  name: string,
  runs: WorkflowRun[],
  jobs: ReadonlyMap<number, WorkflowJob[]>,
  parseJob: DeploymentJobParser,
): DeploymentCommit[] {
  return runs.flatMap((workflowRun) => {
    const serviceJobs = (jobs.get(workflowRun.id) || [])
      .map((job) => ({ job, parsed: parseJob(job.name) }))
      .filter((item): item is { job: WorkflowJob; parsed: { service: string; environment: string } } => item.parsed?.service === name)
    if (!serviceJobs.length) return []
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
        stages: Object.fromEntries(serviceJobs.map(({ job, parsed }) => [parsed.environment, stage(job)])),
      },
    ]
  })
}

function runValue<T>(run: DeploymentCommit | undefined, select: (value: DeploymentCommit) => T): T | undefined {
  return run ? select(run) : undefined
}

function firstDefined<T>(first: T | undefined, second: T | undefined): T | undefined {
  return first === undefined ? second : first
}

function nullable<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

function hasStage(run: DeploymentCommit, environment: string) {
  return run.stages[environment] !== undefined
}

function hasSuccessfulStage(run: DeploymentCommit, environment: string) {
  const candidate = run.stages[environment]
  return candidate !== undefined && candidate.conclusion === 'success'
}

function environmentState(environment: string, runs: DeploymentCommit[]): DeploymentStage | null {
  const attempted = runs.find((item) => hasStage(item, environment))
  const deployed = runs.find((item) => hasSuccessfulStage(item, environment))
  const latestStage = firstDefined(
    runValue(attempted, (run) => run.stages[environment]),
    runValue(deployed, (run) => run.stages[environment]),
  )
  if (!latestStage) return null
  return {
    ...latestStage,
    attempt_sha: nullable(runValue(attempted, (run) => run.sha)),
    attempt_title: nullable(runValue(attempted, (run) => run.title)),
    run_id: firstDefined(
      runValue(attempted, (run) => run.run_id),
      runValue(deployed, (run) => run.run_id),
    ),
    deployed_sha: nullable(runValue(deployed, (run) => run.sha)),
    deployed_title: nullable(runValue(deployed, (run) => run.title)),
    deployed_at: nullable(runValue(deployed, (run) => run.stages[environment].completed_at)),
  }
}

function deploymentEnvironments(target: GitHubDeploymentTargetConfiguration, runs: DeploymentCommit[]) {
  return Object.fromEntries(target.environments.map((environment) => [environment, environmentState(environment, runs)])) as Record<
    string,
    DeploymentStage | null
  >
}

function activeDeploymentState(stages: DeploymentStage[]): DeploymentService['state'] | null {
  if (stages.some((candidate) => candidate.conclusion === 'failure')) return 'failed'
  if (stages.some((candidate) => candidate.status === 'waiting')) return 'waiting'
  if (stages.some((candidate) => ['queued', 'in_progress', 'pending', 'requested'].includes(candidate.status))) return 'deploying'
  return null
}

function deploymentState(
  latest: DeploymentCommit | null,
  productionOutdated: boolean,
  production: DeploymentStage | null,
): DeploymentService['state'] {
  if (!latest) return 'unknown'
  const active = activeDeploymentState(Object.values(latest.stages))
  if (active) return active
  if (productionOutdated) return 'outdated'
  return production?.deployed_sha ? 'deployed' : 'pending'
}

function deploymentDelta(
  repository: string,
  production: DeploymentStage | null,
  comparison: DeploymentStage | null,
  commitCount: number,
): DeploymentService['deployment_delta'] {
  if (!production?.deployed_sha || !comparison?.deployed_sha || production.deployed_sha === comparison.deployed_sha) return null
  return {
    from_sha: production.deployed_sha,
    to_sha: comparison.deployed_sha,
    commit_count: commitCount,
    compare_url: `https://github.com/${repository}/compare/${production.deployed_sha}...${comparison.deployed_sha}`,
  }
}

function serviceForTarget(
  name: string,
  target: GitHubDeploymentTargetConfiguration,
  targetInfo: DeploymentTarget,
  runs: WorkflowRun[],
  jobs: ReadonlyMap<number, WorkflowJob[]>,
  parseJob: DeploymentJobParser,
): InternalService {
  const affectedRuns = commitsForService(name, runs, jobs, parseJob)
  const environments = deploymentEnvironments(target, affectedRuns)
  const productionIndex = affectedRuns.findIndex((item) => item.stages[target.productionEnvironment]?.conclusion === 'success')
  const pending = affectedRuns
    .slice(0, productionIndex < 0 ? affectedRuns.length : productionIndex)
    .filter((item) => item.stages[target.productionEnvironment]?.conclusion !== 'success')
  const latest = affectedRuns[0] || null
  const comparison = environments[target.comparisonEnvironment]
  const production = environments[target.productionEnvironment]
  const productionOutdated = Boolean(
    comparison?.deployed_sha && production?.deployed_sha && comparison.deployed_sha !== production.deployed_sha,
  )
  return {
    key: `${target.id}:${name}`,
    name,
    target: targetInfo,
    state: deploymentState(latest, productionOutdated, production),
    latest,
    environments,
    production_outdated: productionOutdated,
    deployment_delta: deploymentDelta(target.repository, production, comparison, pending.length),
    pending_commits: pending,
    runs: affectedRuns,
  }
}

async function loadTarget(run: RunCommand, target: GitHubDeploymentTargetConfiguration): Promise<InternalService[]> {
  const jobMatcher = compileDeploymentJobMatcher(target.jobNameTemplate)
  const deploymentJob = (name: string) => matchDeploymentJob(name, target, jobMatcher)
  const runsResponse = JSON.parse(
    await run('gh', [
      'api',
      '--method',
      'GET',
      `repos/${target.repository}/actions/workflows/${encodeURIComponent(target.workflow)}/runs`,
      '-f',
      `branch=${target.branch}`,
      '-f',
      `event=${target.event}`,
      '-f',
      'per_page=30',
    ]),
  ) as { workflow_runs?: WorkflowRun[] }
  const runs = runsResponse.workflow_runs || []
  const jobsByRun = await Promise.all(
    runs.map(async (workflowRun) => {
      const response = JSON.parse(
        await run('gh', ['api', '--method', 'GET', `repos/${target.repository}/actions/runs/${workflowRun.id}/jobs`, '-f', 'per_page=100']),
      ) as { jobs?: WorkflowJob[] }
      return [workflowRun.id, response.jobs || []] as const
    }),
  )
  const jobs = new Map<number, WorkflowJob[]>(jobsByRun)
  const serviceNames = new Set(target.services)
  for (const runJobs of jobs.values()) {
    for (const job of runJobs) {
      const parsed = deploymentJob(job.name)
      if (parsed) serviceNames.add(parsed.service)
    }
  }
  const targetInfo = publicTarget(target)
  return [...serviceNames].sort().map((name) => serviceForTarget(name, target, targetInfo, runs, jobs, deploymentJob))
}

function overviewIdentity(targets: GitHubDeploymentTargetConfiguration[]) {
  let hash = 2_166_136_261
  for (const character of JSON.stringify(targets)) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function createGitHubDeploymentProvider(
  run: RunCommand,
  cache?: ExtensionCacheServices,
  refreshTrigger?: CacheRefreshTrigger,
  configuration: DeploymentConfiguration = () => normalizeGitHubDeploymentTargets(undefined),
  tokenForRepository: (repository: string) => string | undefined = () => undefined,
): DeploymentProvider {
  let fallbackCache: { key: string; at: number; value: DeploymentSnapshot | null } = { key: '', at: 0, value: null }
  return {
    id: 'github-actions',
    name: 'GitHub Actions',
    async overview(refresh = false) {
      const targets = configuration().filter((target) => target.enabled)
      const identity = overviewIdentity(targets)
      const loader = async () => {
        const services = (
          await Promise.all(
            targets.map((target) => {
              const token = tokenForRepository(target.repository)
              const routedRun: RunCommand = (command, args, options = {}) => {
                if (token) return run(command, args, { ...options, env: { ...process.env, GH_TOKEN: token } })
                return options.input === undefined ? run(command, args) : run(command, args, options)
              }
              return loadTarget(routedRun, target)
            }),
          )
        ).flat()
        const targetDetails = targets.map(publicTarget)
        const value: DeploymentSnapshot = {
          repository: targets.length === 1 ? targets[0].repository : `${targets.length} configured repositories`,
          workflow: targets.length === 1 ? targets[0].workflow : `${targets.length} configured workflows`,
          refreshed_at: new Date().toISOString(),
          targets: targetDetails,
          services,
          summary: publicSummary(services),
        }
        refreshTrigger?.emitRefresh({
          force: refresh,
          provider: 'github-actions',
          key: `deployments:overview:${identity}`,
          subject: `github:${targets.map((target) => target.repository).join(',')}:deployments`,
          data: { count: services.length, repository: value.repository },
        })
        return value
      }
      if (!cache) {
        if (!refresh && fallbackCache.key === identity && fallbackCache.value && Date.now() - fallbackCache.at < 30_000) {
          return fallbackCache.value
        }
        const value = await loader()
        fallbackCache = { key: identity, at: Date.now(), value }
        return value
      }
      return (
        await cache.getOrLoad(`deployments:overview:${identity}`, loader, {
          ttlMs: 30_000,
          staleWhileRevalidateMs: 120_000,
          tags: ['deployments'],
          forceRefresh: refresh,
        })
      ).value
    },
    async rerun(runId, mode, targetId) {
      const targets = configuration().filter((target) => target.enabled)
      const target = targetId ? targets.find((candidate) => candidate.id === targetId) : targets.length === 1 ? targets[0] : undefined
      if (!target) throw new Error(targetId ? `Deployment target ${targetId} is not available` : 'Deployment target is required')
      const args = [
        'api',
        '--method',
        'POST',
        `repos/${target.repository}/actions/runs/${runId}/${mode === 'failed' ? 'rerun-failed-jobs' : 'rerun'}`,
      ]
      const token = tokenForRepository(target.repository)
      if (token) await run('gh', args, { env: { ...process.env, GH_TOKEN: token } })
      else await run('gh', args)
      cache?.invalidate({ tags: ['deployments'] })
      fallbackCache = { key: '', at: 0, value: null }
    },
  }
}

import { basename, dirname, relative, resolve, sep } from 'node:path'
import type { ResolvedRepositoryEnvironment } from '../repository-environment-profiles.ts'
import type { PreviewPlan, PreviewRun, PreviewServicePlan } from './detect.ts'

export type PreviewEnvironmentResolver = (repositoryId: number, targetPath: string) => ResolvedRepositoryEnvironment

export type PreviewServiceEnvironment = {
  environment: Record<string, string>
  scope: string
  startCommand: string
  stopCommand: string
}

type RuntimeValues = {
  baseDomain: string
  domain: string
  jobId: number
  port: number
  repository: string
  scope: string
  service: string
  url: string
  worktree: string
}

const placeholderPattern = /\{\{(base_domain|domain|job_id|port|repo|scope|service|url|worktree)\}\}/g

export function resolveEnvironmentTemplate(value: string, runtime: RuntimeValues) {
  const replacements: Record<string, string> = {
    base_domain: runtime.baseDomain,
    domain: runtime.domain,
    job_id: String(runtime.jobId),
    port: String(runtime.port || ''),
    repo: runtime.repository,
    scope: runtime.scope,
    service: runtime.service,
    url: runtime.url,
    worktree: runtime.worktree,
  }
  return value.replace(placeholderPattern, (_, name: string) => replacements[name])
}

function pathWithin(root: string, candidate: string) {
  const relation = relative(resolve(root), resolve(candidate))
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..')
}

function serviceTargetPath(worktree: string, plan: PreviewPlan, service: PreviewServicePlan) {
  const candidate = service.context || (service.dockerfile ? dirname(service.dockerfile) : dirname(plan.sourceFile))
  if (!pathWithin(worktree, candidate)) return ''
  const target = relative(worktree, candidate).split(sep).join('/')
  return target === '.' ? '' : target
}

export function previewServiceEnvironments(options: {
  baseDomain: string
  jobId: number
  plan: PreviewPlan
  repositoryId: number
  resolve: PreviewEnvironmentResolver
  serviceAddress: (service: PreviewServicePlan) => { domain: string; url: string }
  worktree: string
}) {
  return new Map(
    options.plan.services.map((service) => {
      const resolved = options.resolve(options.repositoryId, serviceTargetPath(options.worktree, options.plan, service))
      const primary = service.ports.find((port) => port.protocol === 'tcp') || service.ports[0]
      const address = options.serviceAddress(service)
      const runtime: RuntimeValues = {
        baseDomain: options.baseDomain,
        domain: address.domain,
        jobId: options.jobId,
        port: primary?.containerPort || 0,
        repository: resolved.repository,
        scope: resolved.scope,
        service: service.name,
        url: address.url,
        worktree: basename(options.worktree),
      }
      return [
        service.runtimeName,
        {
          environment: Object.fromEntries(
            Object.entries(resolved.variables).map(([name, value]) => [name, resolveEnvironmentTemplate(value, runtime)]),
          ),
          scope: resolved.scope,
          startCommand: resolveEnvironmentTemplate(resolved.startCommand, runtime),
          stopCommand: resolveEnvironmentTemplate(resolved.stopCommand, runtime),
        },
      ] as const
    }),
  )
}

export function applyEnvironmentToCompose(plan: PreviewPlan, environments: Map<string, PreviewServiceEnvironment>) {
  if (!plan.compose) return
  for (const [name, raw] of Object.entries<Record<string, any>>(plan.compose.services || {})) {
    const configured = environments.get(name)
    if (!configured) continue
    const existing = Array.isArray(raw.environment)
      ? Object.fromEntries(
          raw.environment.map(String).map((entry) => {
            const separator = entry.indexOf('=')
            return separator < 0 ? [entry, null] : [entry.slice(0, separator), entry.slice(separator + 1)]
          }),
        )
      : { ...(raw.environment || {}) }
    raw.environment = { ...existing, ...configured.environment }
    if (configured.startCommand) {
      raw.entrypoint = ['sh', '-lc']
      raw.command = [configured.startCommand]
    }
  }
}

export async function runContainerStopCommands(services: Array<{ containerId: string; stopCommand?: string }>, run: PreviewRun) {
  for (const service of services) {
    if (!service.stopCommand || !service.containerId) continue
    await run('docker', ['exec', service.containerId, 'sh', '-lc', service.stopCommand], {
      timeoutMs: 2 * 60_000,
      maxOutputBytes: 2 * 1024 * 1024,
      includeStderr: true,
    })
  }
}

export function previewDockerRunArguments(options: {
  configured?: PreviewServiceEnvironment
  container: string
  image: string
  jobId: number
  service: PreviewServicePlan
}) {
  const primary = options.service.ports.find((port) => port.protocol === 'tcp') || options.service.ports[0]
  const args = ['run', '--detach', '--name', options.container]
  if (options.service.source === 'moon') args.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges')
  args.push(
    '--label',
    'vertexade.preview=true',
    '--label',
    `vertexade.preview.job=${options.jobId}`,
    '--label',
    `vertexade.preview.service=${options.service.runtimeName}`,
    '--env',
    `PORT=${primary.containerPort}`,
  )
  for (const [name, value] of Object.entries(options.configured?.environment || {})) args.push('--env', `${name}=${value}`)
  for (const port of options.service.ports) args.push('--publish', `127.0.0.1::${port.containerPort}/${port.protocol}`)
  if (options.configured?.startCommand) args.push('--entrypoint', 'sh')
  args.push(options.image)
  if (options.configured?.startCommand) args.push('-lc', options.configured.startCommand)
  return args
}

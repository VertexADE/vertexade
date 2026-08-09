import { createHash } from 'node:crypto'
import { chmod, cp, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { pathInsidePreviewWorktree, previewServiceSlug, type PreviewPlan, type PreviewRun, type PreviewServicePlan } from './detect.ts'
import {
  applyEnvironmentToCompose,
  previewDockerRunArguments,
  previewServiceEnvironments,
  runContainerStopCommands,
  type PreviewEnvironmentResolver,
  type PreviewServiceEnvironment,
} from './environment.ts'
import { plannedTcpService, unavailablePreviewServices, type PreviewPublishedPort, type PreviewService } from './readiness.ts'

export type PreviewSettings = {
  domain: string
  gatewayPort: number
}
export type PreviewManifest = {
  source: PreviewPlan['source']
  sourceFile: string
  tools: Array<{ id: string; name: string; sourceFile: string; version?: string }>
  projectName: string | null
  composeFile: string | null
  assetDirectory?: string | null
  warnings: string[]
  services: PreviewService[]
}
export type PreviewRecord = {
  job_id: number
  status: string
  manifest: string | null
  error: string | null
  progress: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  stopped_at: string | null
}

const domainPattern = /^(?:localhost|(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/
const previewLabels = { 'vertexade.preview': 'true' }
function record(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizePreviewSettings(value: unknown): PreviewSettings {
  const input = record(value) ? value : {}
  let domain = String(input.domain || '')
    .trim()
    .toLowerCase()
  domain = domain
    .replace(/^https?:\/\//, '')
    .replace(/^\*\./, '')
    .replace(/\.$/, '')
  if (domain.includes('/') || domain.includes(':') || (domain && !domainPattern.test(domain))) {
    throw new Error('Preview domain must be a hostname such as previews.example.com')
  }
  const gatewayPort = Number(input.gatewayPort ?? 4180)
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65_535) {
    throw new Error('Preview gateway port must be an integer from 1024 to 65535')
  }
  return { domain, gatewayPort }
}

function hostLabel(service: string, jobId: number, containerPort: number, multiplePorts: boolean) {
  const suffix = multiplePorts ? `-${containerPort}-${jobId}` : `-${jobId}`
  return `${previewServiceSlug(service).slice(0, Math.max(1, 63 - suffix.length))}${suffix}`
}

export function previewPublishedPort(
  settings: PreviewSettings,
  service: string,
  jobId: number,
  containerPort: number,
  hostPort: number,
  protocol: 'tcp' | 'udp',
  multiplePorts: boolean,
  publicUrl = true,
): PreviewPublishedPort {
  const hostname = publicUrl && settings.domain ? `${hostLabel(service, jobId, containerPort, multiplePorts)}.${settings.domain}` : ''
  return {
    containerPort,
    hostPort,
    protocol,
    hostname,
    url: publicUrl && protocol === 'tcp' && hostname ? `http://${hostname}:${settings.gatewayPort}` : null,
  }
}

function environmentObject(environment: unknown) {
  if (Array.isArray(environment))
    return Object.fromEntries(
      environment.map(String).map((entry) => {
        const separator = entry.indexOf('=')
        return separator < 0 ? [entry, null] : [entry.slice(0, separator), entry.slice(separator + 1)]
      }),
    )
  return record(environment) ? { ...environment } : {}
}

function safeComposeResourceMap(value: unknown, worktree?: string) {
  if (!record(value)) return undefined
  return Object.fromEntries(
    Object.entries(value).map(([name, resource]) => {
      if (!record(resource)) return [name, resource]
      if (resource.external) throw new Error(`Compose resource ${name} is external and cannot be isolated`)
      const next = { ...resource }
      if (worktree && next.file && !pathInsidePreviewWorktree(worktree, resolve(worktree, String(next.file)))) {
        throw new Error(`Compose resource ${name} reads a file outside the worktree`)
      }
      delete next.name
      return [name, next]
    }),
  )
}

function assertIsolatedNamespaces(name: string, service: Record<string, any>) {
  if (service.privileged) throw new Error(`Compose service ${name} requests privileged mode`)
  if (['host', 'service:', 'container:'].some((value) => String(service.network_mode || '').startsWith(value))) {
    throw new Error(`Compose service ${name} uses a non-isolated network mode`)
  }
  if (service.pid === 'host' || service.ipc === 'host' || service.userns_mode === 'host') {
    throw new Error(`Compose service ${name} shares a host namespace`)
  }
}

function assertNoDevices(name: string, service: Record<string, any>) {
  if (service.devices?.length) throw new Error(`Compose service ${name} requests host devices`)
}

function assertNoCapabilities(name: string, service: Record<string, any>) {
  if (service.cap_add?.length) throw new Error(`Compose service ${name} requests additional Linux capabilities`)
}

function assertDefaultSecurityPolicy(name: string, service: Record<string, any>) {
  if (service.security_opt?.length) throw new Error(`Compose service ${name} overrides container security policy`)
}

function assertNoSharedVolumes(name: string, service: Record<string, any>) {
  if (service.volumes_from?.length) throw new Error(`Compose service ${name} mounts volumes from another container`)
}

function assertNoBuildCredentials(name: string, service: Record<string, any>) {
  if (service.build?.ssh) throw new Error(`Compose service ${name} requests host build credentials`)
  if (service.build?.secrets) throw new Error(`Compose service ${name} requests host build credentials`)
}

function buildContexts(build: unknown) {
  if (!record(build)) return []
  const additional = build.additional_contexts
  if (Array.isArray(additional))
    return additional.map(String).flatMap((entry) => (entry.includes('=') ? [entry.slice(entry.indexOf('=') + 1)] : []))
  return record(additional) ? Object.values(additional).map(String) : []
}

function assertSafeBuildContexts(worktree: string, name: string, service: Record<string, any>) {
  if (!record(service.build)) return
  const values = [service.build.context, ...buildContexts(service.build)].filter(Boolean).map(String)
  for (const value of values) {
    if (/^(?:service:|docker-image:|https?:\/\/|git:\/\/)/.test(value)) continue
    if (!pathInsidePreviewWorktree(worktree, resolve(worktree, value))) {
      throw new Error(`Compose service ${name} uses a build context outside the worktree`)
    }
  }
}

function assertNoElevatedAccess(name: string, service: Record<string, any>) {
  assertNoDevices(name, service)
  assertNoCapabilities(name, service)
  assertDefaultSecurityPolicy(name, service)
  assertNoSharedVolumes(name, service)
  assertNoBuildCredentials(name, service)
}

function assertSafeMounts(worktree: string, name: string, service: Record<string, any>, assetRoot?: string) {
  for (const volume of Array.isArray(service.volumes) ? service.volumes : []) {
    if (!record(volume) || volume.type !== 'bind') continue
    const source = resolve(worktree, String(volume.source || ''))
    if (!pathInsidePreviewWorktree(worktree, source) && (!assetRoot || !pathInsidePreviewWorktree(assetRoot, source))) {
      throw new Error(`Compose service ${name} bind-mounts outside the worktree`)
    }
  }
}

function assertSafeService(worktree: string, name: string, service: Record<string, any>, assetRoot?: string) {
  assertIsolatedNamespaces(name, service)
  assertNoElevatedAccess(name, service)
  assertSafeMounts(worktree, name, service, assetRoot)
  assertSafeBuildContexts(worktree, name, service)
}

function resolvedPreviewEnvironment(
  environment: Record<string, any>,
  plan: PreviewPlan,
  settings: PreviewSettings | undefined,
  jobId: number,
) {
  if (!settings) return environment
  return Object.fromEntries(
    Object.entries(environment).map(([key, raw]) => {
      if (typeof raw !== 'string') return [key, raw]
      const value = raw.replace(/vertexade-preview:\/\/([a-z0-9-]+)\/(\d+)/g, (match, serviceName, rawPort) => {
        const service = plan.services.find((candidate) => candidate.name === serviceName)
        const port = Number(rawPort)
        if (!service?.ports.some((candidate) => candidate.containerPort === port && candidate.protocol === 'tcp')) return match
        return previewPublishedPort(settings, serviceName, jobId, port, 0, 'tcp', service.ports.length > 1).url || match
      })
      return [key, value]
    }),
  )
}

export function isolatedCompose(plan: PreviewPlan, worktree: string, jobId: number, settings?: PreviewSettings, assetRoot?: string) {
  if (!plan.compose) throw new Error('Compose configuration is unavailable')
  const services = Object.fromEntries(
    Object.entries<Record<string, any>>(plan.compose.services || {}).map(([name, raw]) => {
      assertSafeService(worktree, name, raw, assetRoot)
      const service = structuredClone(raw)
      const detected = plan.services.find((candidate) => candidate.runtimeName === name)
      delete service.container_name
      delete service.network_mode
      service.labels = {
        ...(record(service.labels) ? service.labels : {}),
        ...previewLabels,
        'vertexade.preview.job': String(jobId),
        'vertexade.preview.service': name,
      }
      service.environment = resolvedPreviewEnvironment(environmentObject(service.environment), plan, settings, jobId)
      if (detected?.ports.length)
        service.environment.PORT = String(
          detected.ports.find((port) => port.protocol === 'tcp')?.containerPort || detected.ports[0].containerPort,
        )
      if (detected?.source === 'dockerfile' && !service.restart) service.restart = 'on-failure:5'
      service.ports = (detected?.ports || []).map((port) => ({
        target: port.containerPort,
        protocol: port.protocol,
        host_ip: '127.0.0.1',
        mode: 'ingress',
      }))
      return [name, service]
    }),
  )
  return {
    services,
    ...(plan.compose.volumes ? { volumes: safeComposeResourceMap(plan.compose.volumes) } : {}),
    ...(plan.compose.networks ? { networks: safeComposeResourceMap(plan.compose.networks) } : {}),
    ...(plan.compose.secrets ? { secrets: safeComposeResourceMap(plan.compose.secrets, worktree) } : {}),
    ...(plan.compose.configs ? { configs: safeComposeResourceMap(plan.compose.configs, worktree) } : {}),
  }
}

async function copyablePreviewAsset(source: string, worktree: string) {
  const sourceValue = await lstat(source)
  if (sourceValue.isSymbolicLink()) throw new Error(`Preview bind source cannot be a symbolic link: ${source}`)
  const actual = await realpath(source)
  if (!pathInsidePreviewWorktree(worktree, actual)) throw new Error(`Preview bind source resolves outside the worktree: ${source}`)
  if (sourceValue.isDirectory()) {
    for (const entry of await readdir(actual)) await copyablePreviewAsset(join(actual, entry), worktree)
  }
  return actual
}

async function makeContainerReadable(path: string) {
  const value = await lstat(path)
  if (value.isDirectory()) {
    await chmod(path, 0o755)
    for (const entry of await readdir(path)) await makeContainerReadable(join(path, entry))
  } else {
    await chmod(path, 0o644)
  }
}

export async function stagePreviewBindMounts(plan: PreviewPlan, worktree: string, assetRoot: string) {
  if (!plan.compose) return plan
  const next: PreviewPlan = { ...plan, compose: structuredClone(plan.compose) }
  const actualWorktree = await realpath(worktree)
  await rm(assetRoot, { recursive: true, force: true })
  await mkdir(assetRoot, { recursive: true, mode: 0o700 })
  for (const [serviceName, service] of Object.entries<Record<string, any>>(next.compose.services || {})) {
    const volumes = Array.isArray(service.volumes) ? service.volumes : []
    for (const [index, volume] of volumes.entries()) {
      if (!record(volume) || volume.type !== 'bind' || !volume.read_only) continue
      const source = resolve(worktree, String(volume.source || ''))
      if (!pathInsidePreviewWorktree(worktree, source)) continue
      const actual = await copyablePreviewAsset(source, actualWorktree)
      const destination = join(assetRoot, `${previewServiceSlug(serviceName)}-${index}-${basename(actual)}`)
      await cp(actual, destination, { recursive: true, force: true, dereference: true })
      await makeContainerReadable(destination)
      volume.source = destination
    }
  }
  return next
}

function serviceDependencies(service: Record<string, any>) {
  if (Array.isArray(service.depends_on)) return service.depends_on.map(String)
  return record(service.depends_on) ? Object.keys(service.depends_on) : []
}

export function degradedPreviewPlan(plan: PreviewPlan, failedServices: string[]) {
  if (!plan.compose || !failedServices.length) return null
  const composeServices = record(plan.compose.services) ? plan.compose.services : {}
  const removed = new Set(failedServices.filter((name) => composeServices[name]))
  let changed = true
  while (changed) {
    changed = false
    for (const [name, service] of Object.entries<Record<string, any>>(composeServices)) {
      if (removed.has(name) || !serviceDependencies(service).some((dependency) => removed.has(dependency))) continue
      removed.add(name)
      changed = true
    }
  }
  const services = plan.services.filter((service) => !removed.has(service.runtimeName))
  const publicServices = services.filter((service) => service.ports.some((port) => port.protocol === 'tcp' && port.public !== false))
  if (!removed.size || !publicServices.length) return null
  const compose = structuredClone(plan.compose)
  compose.services = Object.fromEntries(Object.entries(composeServices).filter(([name]) => !removed.has(name)))
  return {
    ...plan,
    services,
    compose,
    warnings: [...plan.warnings, `Skipped unavailable preview dependency chain: ${[...removed].join(', ')}`],
  }
}

export function parseInspect(output: string) {
  const value = JSON.parse(output)
  return Array.isArray(value) ? value : [value]
}

export function cleanProgressLine(value: string) {
  return value
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function compactPreviewError(value: string) {
  const lines = value.split(/\r?\n/).map(cleanProgressLine).filter(Boolean)
  const important = lines.filter((line) => /(?:error|failed|unhealthy|denied|not found|cannot|timed out|segmentation)/i.test(line))
  return [...new Set((important.length ? important : lines).slice(-20))].join('\n').slice(0, 8_000) || 'Preview startup failed'
}

export function latestProgress(value: string) {
  const lines = value.split(/\r?\n/).map(cleanProgressLine).filter(Boolean)
  return lines.at(-1)?.slice(0, 240) || null
}

function safeMoonVersion(plan: PreviewPlan) {
  const version = plan.tools.find((tool) => tool.id === 'moon')?.version || 'latest'
  return /^[a-z0-9._+-]+$/i.test(version) ? version : 'latest'
}

function moonBootstrapImage(plan: PreviewPlan) {
  const version = plan.tools.find((tool) => tool.id === 'node')?.version || '22'
  const tag = /^[a-z0-9._+-]+$/i.test(version) ? version : '22'
  return `node:${tag}-bookworm-slim`
}

export function moonPreviewDockerfile(plan: PreviewPlan, service: PreviewServicePlan) {
  if (!service.project || !service.task) throw new Error(`Moon preview service ${service.name} has no project task`)
  const port = service.ports.find((candidate) => candidate.protocol === 'tcp')?.containerPort || 3000
  const moonPackage = `@moonrepo/cli@${safeMoonVersion(plan)}`
  const bootstrapImage = moonBootstrapImage(plan)
  return [
    `FROM ${bootstrapImage} AS scaffold`,
    'WORKDIR /workspace',
    `RUN ${JSON.stringify(['npm', 'install', '--global', moonPackage])}`,
    'COPY . .',
    `RUN ${JSON.stringify(['rm', '-rf', '.git', '.moon/cache'])}`,
    `RUN ${JSON.stringify(['moon', 'docker', 'scaffold', service.project])}`,
    '',
    `FROM ${bootstrapImage}`,
    'WORKDIR /workspace',
    `RUN ${JSON.stringify(['npm', 'install', '--global', moonPackage])}`,
    'COPY --from=scaffold /workspace/.moon/docker/workspace .',
    `RUN ${JSON.stringify(['moon', 'docker', 'setup'])}`,
    'COPY --from=scaffold /workspace/.moon/docker/sources .',
    'ENV MOON_DAEMON=false HOST=0.0.0.0 HOSTNAME=0.0.0.0',
    `EXPOSE ${port}`,
    `CMD ${JSON.stringify(['moon', 'run', `${service.project}:${service.task}`])}`,
    '',
  ].join('\n')
}

export function containerPorts(inspect: Record<string, any>) {
  return Object.entries<any>(inspect.NetworkSettings?.Ports || {}).flatMap(([key, bindings]) => {
    const [rawPort, protocolValue] = key.split('/')
    const containerPort = Number(rawPort)
    const protocol = protocolValue === 'udp' ? ('udp' as const) : ('tcp' as const)
    if (!Number.isInteger(containerPort) || !Array.isArray(bindings)) return []
    return bindings.flatMap((binding) => {
      const hostPort = Number(binding?.HostPort)
      return Number.isInteger(hostPort) ? [{ containerPort, hostPort, protocol }] : []
    })
  })
}

export function publicRecord(row: PreviewRecord | undefined) {
  if (!row)
    return {
      status: 'idle',
      manifest: null,
      error: null,
      progress: null,
      created_at: null,
      updated_at: null,
      started_at: null,
      stopped_at: null,
    }
  let manifest: PreviewManifest | null = null
  try {
    manifest = row.manifest ? JSON.parse(row.manifest) : null
  } catch {}
  return {
    status: row.status,
    manifest,
    error: row.error,
    progress: row.progress,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    stopped_at: row.stopped_at,
  }
}

export async function capturedStopFailure(manifest: PreviewManifest, run: PreviewRun) {
  try {
    await runContainerStopCommands(manifest.services, run)
    return null
  } catch (error) {
    return error
  }
}

export function assertStopSucceeded(error: unknown) {
  if (!error) return
  throw new Error(`Container stop command failed: ${error instanceof Error ? error.message : String(error)}`)
}

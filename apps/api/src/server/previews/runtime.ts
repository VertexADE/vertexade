import { createHash } from 'node:crypto'
import { chmod, cp, lstat, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { trustWorkspaceMiseConfigs } from '@vertexade/platform-server/agents'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { worktreePreviews } from '../database/schema/tables.ts'
import {
  detectWorktreePreview,
  pathInsidePreviewWorktree,
  previewServiceSlug,
  type PreviewPlan,
  type PreviewRun,
  type PreviewServicePlan,
} from './detect.ts'
import {
  applyEnvironmentToCompose,
  previewDockerRunArguments,
  previewServiceEnvironments,
  runContainerStopCommands,
  type PreviewEnvironmentResolver,
  type PreviewServiceEnvironment,
} from './environment.ts'
import { cleanupFailedCompose, removeComposePreview } from './container-lifecycle.ts'
import {
  inspectServiceReadyAndReachable,
  plannedTcpService,
  publishedTcpServiceReady,
  unavailablePreviewServices,
  type PreviewPublishedPort,
  type PreviewService,
} from './readiness.ts'
import {
  assertStopSucceeded,
  capturedStopFailure,
  cleanProgressLine,
  compactPreviewError,
  containerPorts,
  degradedPreviewPlan,
  isolatedCompose,
  latestProgress,
  moonPreviewDockerfile,
  parseInspect,
  previewPublishedPort,
  publicRecord,
  stagePreviewBindMounts,
} from './runtime-support.ts'
export { unavailablePreviewServices, type PreviewPublishedPort } from './readiness.ts'
export {
  compactPreviewError,
  degradedPreviewPlan,
  isolatedCompose,
  moonPreviewDockerfile,
  normalizePreviewSettings,
  previewPublishedPort,
  stagePreviewBindMounts,
} from './runtime-support.ts'
export type PreviewSettings = {
  domain: string
  gatewayPort: number
}
type PreviewManifest = {
  source: PreviewPlan['source']
  sourceFile: string
  tools: Array<{ id: string; name: string; sourceFile: string; version?: string }>
  projectName: string | null
  composeFile: string | null
  assetDirectory?: string | null
  warnings: string[]
  services: PreviewService[]
}
type PreviewJob = {
  id: number
  repo_id?: number
  worktree_path: string
  worktree_removed_at?: string | null
}
type PreviewRecord = {
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
type PreviewRuntimeOptions = {
  db: DrizzleDashboardDatabase
  dataDirectory: string
  run: PreviewRun
  settings: () => PreviewSettings
  environment?: PreviewEnvironmentResolver
  onChange?: (reason: string, jobId: number) => void
}
export class WorktreePreviewRuntime {
  private readonly active = new Map<number, Promise<void>>()
  private readonly directory: string

  constructor(private readonly options: PreviewRuntimeOptions) {
    this.directory = join(options.dataDirectory, 'worktree-previews')
  }

  get(jobId: number) {
    const row = this.options.db
      .select({
        job_id: worktreePreviews.jobId,
        status: worktreePreviews.status,
        manifest: worktreePreviews.manifest,
        error: worktreePreviews.error,
        progress: worktreePreviews.progress,
        created_at: worktreePreviews.createdAt,
        updated_at: worktreePreviews.updatedAt,
        started_at: worktreePreviews.startedAt,
        stopped_at: worktreePreviews.stoppedAt,
      })
      .from(worktreePreviews)
      .where(eq(worktreePreviews.jobId, jobId))
      .get()
    return publicRecord(row)
  }

  private progress(jobId: number, value: string) {
    const progress = cleanProgressLine(value).slice(0, 240)
    if (!progress) return
    this.options.db
      .update(worktreePreviews)
      .set({ progress, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(worktreePreviews.jobId, jobId), eq(worktreePreviews.status, 'starting')))
      .run()
    this.changed('preview_progress', jobId)
  }

  start(job: PreviewJob) {
    if (this.active.has(job.id)) return this.get(job.id)
    const settings = this.options.settings()
    if (!settings.domain) throw new Error('Configure a wildcard preview domain in Settings before starting a preview')
    if (job.worktree_removed_at) throw new Error('This worktree has already been removed')
    const previous = this.get(job.id)
    if (previous.status === 'running') return previous
    this.options.db
      .insert(worktreePreviews)
      .values({ jobId: job.id, status: 'starting', error: null, progress: 'Inspecting repository', manifest: null })
      .onConflictDoUpdate({
        target: worktreePreviews.jobId,
        set: {
          status: 'starting',
          error: null,
          progress: 'Inspecting repository',
          manifest: null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
          startedAt: null,
          stoppedAt: null,
        },
      })
      .run()
    this.changed('preview_starting', job.id)
    const operation = this.replace(job, settings, previous.manifest).finally(() => this.active.delete(job.id))
    this.active.set(job.id, operation)
    return this.get(job.id)
  }

  stop(jobId: number) {
    if (this.active.has(jobId)) throw new Error('Wait for the current preview operation to finish')
    const current = this.get(jobId)
    if (current.status === 'idle' || current.status === 'stopped') return current
    this.options.db
      .update(worktreePreviews)
      .set({ status: 'stopping', updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(worktreePreviews.jobId, jobId))
      .run()
    const operation = this.stopNow(jobId, current.manifest).finally(() => this.active.delete(jobId))
    this.active.set(jobId, operation)
    this.changed('preview_stopping', jobId)
    return this.get(jobId)
  }

  restart(job: PreviewJob) {
    if (this.active.has(job.id)) throw new Error('Wait for the current preview operation to finish')
    const settings = this.options.settings()
    if (!settings.domain) throw new Error('Configure a wildcard preview domain in Settings before starting a preview')
    const current = this.get(job.id)
    this.options.db
      .update(worktreePreviews)
      .set({ status: 'starting', error: null, progress: 'Inspecting repository', updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(worktreePreviews.jobId, job.id))
      .run()
    const operation = this.replace(job, settings, current.manifest).finally(() => this.active.delete(job.id))
    this.active.set(job.id, operation)
    this.changed('preview_restarting', job.id)
    return this.get(job.id)
  }

  async logs(jobId: number) {
    const preview = this.get(jobId)
    if (!preview.manifest?.services.length) return { services: [] }
    const services = await Promise.all(
      preview.manifest.services.map(async (service) => {
        try {
          const content = await this.options.run('docker', ['logs', '--tail', '200', service.containerId], {
            timeoutMs: 15_000,
            maxOutputBytes: 1_000_000,
            includeStderr: true,
          })
          return { name: service.name, content }
        } catch (error) {
          return {
            name: service.name,
            content: error instanceof Error ? error.message : String(error),
          }
        }
      }),
    )
    return { services }
  }

  async stopAndWait(jobId: number) {
    await this.active.get(jobId)
    const current = this.get(jobId)
    if (current.status === 'idle' || current.status === 'stopped') return
    await this.removeContainers(current.manifest)
    this.markStopped(jobId)
  }

  private markStopped(jobId: number) {
    this.options.db
      .update(worktreePreviews)
      .set({
        status: 'stopped',
        error: null,
        progress: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        stoppedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(worktreePreviews.jobId, jobId))
      .run()
    this.changed('preview_stopped', jobId)
  }

  refreshUrls(settings: PreviewSettings) {
    const rows = this.options.db
      .select({ job_id: worktreePreviews.jobId, manifest: worktreePreviews.manifest })
      .from(worktreePreviews)
      .where(isNotNull(worktreePreviews.manifest))
      .all()
    for (const row of rows) {
      let manifest: PreviewManifest
      try {
        manifest = JSON.parse(row.manifest)
      } catch {
        continue
      }
      for (const service of manifest.services) {
        service.ports = service.ports.map((port) =>
          previewPublishedPort(
            settings,
            service.name,
            Number(row.job_id),
            port.containerPort,
            port.hostPort,
            port.protocol,
            service.ports.length > 1,
            port.protocol !== 'tcp' || Boolean(port.url),
          ),
        )
      }
      this.options.db
        .update(worktreePreviews)
        .set({ manifest: JSON.stringify(manifest), updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(worktreePreviews.jobId, row.job_id))
        .run()
    }
  }

  private async managedContainers() {
    try {
      const output = await this.options.run('docker', ['ps', '-aq', '--filter', 'label=vertexade.preview=true'], {
        timeoutMs: 15_000,
      })
      const ids = output.trim().split(/\s+/).filter(Boolean)
      return ids.length ? parseInspect(await this.options.run('docker', ['inspect', ...ids], { timeoutMs: 30_000 })) : []
    } catch {
      return null
    }
  }

  private parsedManifest(value: string | null) {
    try {
      return value ? (JSON.parse(value) as PreviewManifest) : null
    } catch {
      return null
    }
  }

  private refreshContainerStates(manifest: PreviewManifest, byId: Map<string, Record<string, any>>) {
    for (const service of manifest.services) service.status = byId.get(service.containerId)?.State?.Status || 'missing'
  }

  private previewIsRunning(manifest: PreviewManifest) {
    const published = manifest.services.filter((service) => service.ports.some((port) => port.protocol === 'tcp'))
    return published.length > 0 && published.every(publishedTcpServiceReady)
  }

  private reconciledState(running: boolean) {
    return running ? { status: 'running', error: null } : { status: 'failed', error: 'Preview containers are no longer running' }
  }

  private reconcileRow(row: any, byId: Map<string, Record<string, any>>) {
    if (!['starting', 'running', 'stopping'].includes(row.status)) return false
    const manifest = this.parsedManifest(row.manifest)
    if (!manifest) {
      this.options.db
        .update(worktreePreviews)
        .set({
          status: 'failed',
          error: 'Preview startup was interrupted',
          progress: null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(worktreePreviews.jobId, row.job_id))
        .run()
      return false
    }
    this.refreshContainerStates(manifest, byId)
    const state = this.reconciledState(this.previewIsRunning(manifest))
    this.options.db
      .update(worktreePreviews)
      .set({ status: state.status, manifest: JSON.stringify(manifest), error: state.error, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(worktreePreviews.jobId, row.job_id))
      .run()
    return true
  }

  private async removeOrphans(containers: Record<string, any>[], known: Set<number>) {
    const ids = containers
      .filter((container) => !known.has(Number(container.Config?.Labels?.['vertexade.preview.job'])))
      .map((container) => container.Id)
    if (ids.length) await this.options.run('docker', ['rm', '--force', ...ids], { timeoutMs: 60_000 }).catch(() => undefined)
  }

  async reconcile() {
    const inspected = await this.managedContainers()
    if (!inspected) return
    const byId = new Map(inspected.map((container) => [container.Id, container]))
    const rows = this.options.db
      .select({
        job_id: worktreePreviews.jobId,
        status: worktreePreviews.status,
        manifest: worktreePreviews.manifest,
      })
      .from(worktreePreviews)
      .all()
    const known = new Set<number>()
    for (const row of rows) {
      if (row.status === 'stopping') {
        await this.stopNow(row.job_id, this.parsedManifest(row.manifest))
        continue
      }
      if (this.reconcileRow(row, byId)) known.add(Number(row.job_id))
    }
    await this.removeOrphans(inspected, known)
    this.refreshUrls(this.options.settings())
  }

  private async replace(job: PreviewJob, settings: PreviewSettings, previous: PreviewManifest | null) {
    try {
      await this.removeContainers(previous)
    } catch (error) {
      return this.fail(job.id, error)
    }
    await this.startNow(job, settings)
  }

  private fail(jobId: number, error: unknown) {
    const message = compactPreviewError(error instanceof Error ? error.message : String(error))
    this.options.db
      .update(worktreePreviews)
      .set({
        status: 'failed',
        error: message,
        progress: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        stoppedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(worktreePreviews.jobId, jobId))
      .run()
    this.changed('preview_failed', jobId)
  }

  private async startNow(job: PreviewJob, settings: PreviewSettings) {
    let launched: PreviewManifest | null = null
    try {
      await mkdir(this.directory, { recursive: true })
      const worktree = await realpath(job.worktree_path)
      this.progress(job.id, 'Preparing the isolated workspace')
      await trustWorkspaceMiseConfigs(this.options.run, worktree)
      await this.options.run('docker', ['info', '--format', '{{.ServerVersion}}'], {
        timeoutMs: 15_000,
      })
      this.progress(job.id, 'Detecting repository services and dependencies')
      const plan = await detectWorktreePreview(worktree, this.options.run)
      const environments = this.options.environment
        ? previewServiceEnvironments({
            baseDomain: settings.domain,
            jobId: job.id,
            plan,
            repositoryId: Number(job.repo_id),
            resolve: this.options.environment,
            serviceAddress: (service) => {
              const primary = service.ports.find((port) => port.protocol === 'tcp') || service.ports[0]
              if (!primary) return { domain: '', url: '' }
              const published = previewPublishedPort(
                settings,
                service.name,
                job.id,
                primary.containerPort,
                0,
                primary.protocol,
                service.ports.length > 1,
                primary.public !== false,
              )
              return { domain: published.hostname, url: published.url || '' }
            },
            worktree,
          })
        : new Map<string, PreviewServiceEnvironment>()
      applyEnvironmentToCompose(plan, environments)
      launched = plan.compose
        ? await this.startCompose(job.id, worktree, plan, settings, environments)
        : plan.source === 'moon'
          ? await this.startMoon(job.id, worktree, plan, settings, environments)
          : await this.startDockerfiles(job.id, worktree, plan, settings, environments)
      const unavailable = unavailablePreviewServices(plan, launched.services)
      if (unavailable.length) throw new Error(await this.previewStartFailure(unavailable))
      if (!launched.services.some((service) => service.ports.some((port) => port.protocol === 'tcp')))
        throw new Error('Containers started, but no TCP service port could be published')
      this.options.db
        .update(worktreePreviews)
        .set({
          status: 'running',
          manifest: JSON.stringify(launched),
          error: null,
          progress: null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
          startedAt: sql`CURRENT_TIMESTAMP`,
          stoppedAt: null,
        })
        .where(eq(worktreePreviews.jobId, job.id))
        .run()
      this.changed('preview_running', job.id)
    } catch (error) {
      if (launched) await this.removeContainers(launched).catch(() => undefined)
      this.fail(job.id, error)
    }
  }

  private async previewStartFailure(services: PreviewService[]) {
    const logs = await Promise.all(
      services.map(async (service) => {
        if (!service.containerId) return ''
        return this.options
          .run('docker', ['logs', '--tail', '80', service.containerId], {
            timeoutMs: 15_000,
            maxOutputBytes: 500_000,
            includeStderr: true,
          })
          .catch((error) => (error instanceof Error ? error.message : String(error)))
      }),
    )
    const states = services.map((service) => `${service.name} (${service.status})`).join(', ')
    return [`Preview services failed to start: ${states}`, ...logs.filter(Boolean)].join('\n\n')
  }

  private async waitForComposeReadiness(jobId: number, projectName: string, plan: PreviewPlan) {
    const expected = plan.services.filter(plannedTcpService)
    const deadline = Date.now() + 90_000
    let readySince = 0
    while (Date.now() < deadline) {
      const ids = (await this.options.run('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${projectName}`]))
        .trim()
        .split(/\s+/)
        .filter(Boolean)
      const inspected = ids.length ? parseInspect(await this.options.run('docker', ['inspect', ...ids])) : []
      const byService = new Map(inspected.map((container) => [container.Config?.Labels?.['com.docker.compose.service'], container]))
      const readiness = await Promise.all(
        expected.map(
          async (service) =>
            [service.runtimeName, await inspectServiceReadyAndReachable(byService.get(service.runtimeName), service)] as const,
        ),
      )
      const unavailable = readiness.filter(([, ready]) => !ready).map(([name]) => name)
      if (!unavailable.length) {
        if (!readySince) readySince = Date.now()
        if (Date.now() - readySince >= 15_000) return { inspected, unavailable }
        this.progress(jobId, 'Confirming preview services remain healthy')
      } else {
        readySince = 0
        this.progress(jobId, `Waiting for preview services: ${unavailable.join(', ')}`)
        const terminal = unavailable.some((name) => ['dead', 'exited'].includes(byService.get(name)?.State?.Status))
        if (terminal) return { inspected, unavailable }
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 2_000)
      })
    }
    const ids = (await this.options.run('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${projectName}`]))
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    const inspected = ids.length ? parseInspect(await this.options.run('docker', ['inspect', ...ids])) : []
    const byService = new Map(inspected.map((container) => [container.Config?.Labels?.['com.docker.compose.service'], container]))
    const readiness = await Promise.all(
      expected.map(
        async (service) =>
          [service.runtimeName, await inspectServiceReadyAndReachable(byService.get(service.runtimeName), service)] as const,
      ),
    )
    return { inspected, unavailable: readiness.filter(([, ready]) => !ready).map(([name]) => name) }
  }

  private async startCompose(
    jobId: number,
    worktree: string,
    plan: PreviewPlan,
    settings: PreviewSettings,
    environments: Map<string, PreviewServiceEnvironment>,
  ): Promise<PreviewManifest> {
    const projectName = `vertexade-preview-${jobId}`
    const composeFile = join(this.directory, `${projectName}.json`)
    const assetRoot = join(this.directory, `${projectName}-assets`)
    this.progress(jobId, 'Staging container-readable preview assets')
    let activePlan = await stagePreviewBindMounts(plan, worktree, assetRoot)
    let lastProgress = 0
    const onOutput = (value: string) => {
      const progress = latestProgress(value)
      const now = Date.now()
      if (!progress || now - lastProgress < 500) return
      lastProgress = now
      this.progress(jobId, progress)
    }
    const writeCompose = async () => {
      await writeFile(composeFile, `${JSON.stringify(isolatedCompose(activePlan, worktree, jobId, settings, assetRoot), null, 2)}\n`, {
        mode: 0o600,
      })
    }
    const launch = async (build = true) => {
      await writeCompose()
      await this.options.run(
        'docker',
        ['compose', '-p', projectName, '-f', composeFile, 'up', '--detach', build ? '--build' : '--no-build', '--remove-orphans'],
        {
          cwd: worktree,
          timeoutMs: 30 * 60_000,
          maxOutputBytes: 20 * 1024 * 1024,
          onOutput,
        },
      )
    }
    try {
      await launch()
    } catch (initialError) {
      const ids = (
        await this.options.run('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${projectName}`]).catch(() => '')
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean)
      const inspected = ids.length ? parseInspect(await this.options.run('docker', ['inspect', ...ids]).catch(() => '[]')) : []
      const failed = inspected
        .filter(
          (container) =>
            ['dead', 'exited', 'restarting'].includes(container.State?.Status) || container.State?.Health?.Status === 'unhealthy',
        )
        .map((container) => container.Config?.Labels?.['com.docker.compose.service'])
        .filter(Boolean)
      const degraded = degradedPreviewPlan(activePlan, failed)
      if (!degraded) {
        await cleanupFailedCompose(this.options.run, projectName, composeFile, assetRoot)
        throw initialError
      }
      activePlan = degraded
      Object.assign(plan, degraded)
      this.progress(jobId, `Retrying without unavailable dependency chain: ${failed.join(', ')}`)
      try {
        await launch(false)
      } catch (retryError) {
        await cleanupFailedCompose(this.options.run, projectName, composeFile, assetRoot)
        throw retryError
      }
    }
    try {
      let readiness = await this.waitForComposeReadiness(jobId, projectName, activePlan)
      let inspected = readiness.inspected
      const unavailable = readiness.unavailable
      const degraded = degradedPreviewPlan(activePlan, unavailable)
      if (degraded) {
        activePlan = degraded
        Object.assign(plan, degraded)
        this.progress(jobId, `Retrying without unavailable preview services: ${unavailable.join(', ')}`)
        await launch(false)
        readiness = await this.waitForComposeReadiness(jobId, projectName, activePlan)
        inspected = readiness.inspected
      }
      return this.manifest(jobId, worktree, plan, settings, inspected, projectName, composeFile, environments, assetRoot)
    } catch (error) {
      await cleanupFailedCompose(this.options.run, projectName, composeFile, assetRoot)
      throw error
    }
  }

  private async startDockerfiles(
    jobId: number,
    worktree: string,
    plan: PreviewPlan,
    settings: PreviewSettings,
    environments: Map<string, PreviewServiceEnvironment>,
  ): Promise<PreviewManifest> {
    const ids: string[] = []
    try {
      for (const service of plan.services) {
        if (!service.ports.length) continue
        this.progress(jobId, `Building ${service.name}`)
        const identity = createHash('sha256').update(`${jobId}:${service.name}`).digest('hex').slice(0, 12)
        const image = `vertexade-preview:${identity}`
        const container = `vertexade-preview-${jobId}-${service.name}`.slice(0, 63)
        await this.options.run('docker', ['build', '--file', service.dockerfile!, '--tag', image, service.context!], {
          cwd: worktree,
          timeoutMs: 30 * 60_000,
          maxOutputBytes: 20 * 1024 * 1024,
        })
        const configured = environments.get(service.runtimeName)
        const args = previewDockerRunArguments({ configured, container, image, jobId, service })
        ids.push((await this.options.run('docker', args, { cwd: worktree, timeoutMs: 60_000 })).trim())
      }
      const inspected = ids.length ? parseInspect(await this.options.run('docker', ['inspect', ...ids])) : []
      return this.manifest(jobId, worktree, plan, settings, inspected, null, null, environments)
    } catch (error) {
      if (ids.length) await this.options.run('docker', ['rm', '--force', ...ids]).catch(() => undefined)
      throw error
    }
  }

  private async startMoon(
    jobId: number,
    worktree: string,
    plan: PreviewPlan,
    settings: PreviewSettings,
    environments: Map<string, PreviewServiceEnvironment>,
  ) {
    const services: PreviewServicePlan[] = []
    for (const service of plan.services) {
      const dockerfile = join(this.directory, `vertexade-preview-${jobId}-${service.name}.Dockerfile`)
      await writeFile(dockerfile, moonPreviewDockerfile(plan, service), { mode: 0o600 })
      services.push({ ...service, context: worktree, dockerfile })
    }
    return this.startDockerfiles(jobId, worktree, { ...plan, services }, settings, environments)
  }

  private manifest(
    jobId: number,
    worktree: string,
    plan: PreviewPlan,
    settings: PreviewSettings,
    inspected: Record<string, any>[],
    projectName: string | null,
    composeFile: string | null,
    environments: Map<string, PreviewServiceEnvironment>,
    assetDirectory: string | null = null,
  ): PreviewManifest {
    const services = inspected.map((container) => {
      const runtimeName =
        container.Config?.Labels?.['vertexade.preview.service'] ||
        container.Config?.Labels?.['com.docker.compose.service'] ||
        container.Name?.replace(/^\//, '') ||
        'service'
      const name = previewServiceSlug(runtimeName)
      const ports = containerPorts(container)
      const planned = plan.services.find((service) => previewServiceSlug(service.runtimeName) === name)
      const configured = planned ? environments.get(planned.runtimeName) : undefined
      return {
        name,
        containerId: container.Id,
        containerName: String(container.Name || '').replace(/^\//, ''),
        status: container.State?.Status || 'unknown',
        source: planned?.source,
        project: planned?.project,
        task: planned?.task,
        environmentScope: configured?.scope,
        stopCommand: configured?.stopCommand,
        ports: ports.map((port) => {
          const plannedPort = planned?.ports.find(
            (candidate) => candidate.containerPort === port.containerPort && candidate.protocol === port.protocol,
          )
          return previewPublishedPort(
            settings,
            name,
            jobId,
            port.containerPort,
            port.hostPort,
            port.protocol,
            ports.length > 1,
            plannedPort?.public !== false,
          )
        }),
      }
    })
    return {
      source: plan.source,
      sourceFile: relative(worktree, plan.sourceFile) || basename(plan.sourceFile),
      projectName,
      composeFile,
      assetDirectory,
      tools: plan.tools.map((tool) => ({
        ...tool,
        sourceFile: relative(worktree, tool.sourceFile) || basename(tool.sourceFile),
      })),
      warnings: plan.warnings,
      services,
    }
  }

  private async stopNow(jobId: number, manifest: PreviewManifest | null) {
    try {
      await this.removeContainers(manifest)
      this.markStopped(jobId)
    } catch (error) {
      this.options.db
        .update(worktreePreviews)
        .set({
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(worktreePreviews.jobId, jobId))
        .run()
      this.changed('preview_failed', jobId)
    }
  }

  private async removeContainers(manifest: PreviewManifest | null) {
    if (!manifest) return
    const stopFailure = await capturedStopFailure(manifest, this.options.run)
    if (manifest.projectName && manifest.composeFile) {
      const safeAssetDirectory =
        manifest.assetDirectory &&
        pathInsidePreviewWorktree(this.directory, manifest.assetDirectory) &&
        basename(manifest.assetDirectory).startsWith('vertexade-preview-')
          ? manifest.assetDirectory
          : null
      await removeComposePreview(this.options.run, manifest.projectName, manifest.composeFile, safeAssetDirectory)
    } else {
      const ids = manifest.services.map((service) => service.containerId).filter(Boolean)
      if (ids.length) await this.options.run('docker', ['rm', '--force', ...ids], { timeoutMs: 60_000 })
    }
    assertStopSucceeded(stopFailure)
  }

  private changed(reason: string, jobId: number) {
    this.options.onChange?.(reason, jobId)
  }
}

import { Effect } from 'effect'
import { type ApiEffect, runApiEffectResponse, tryApi, tryApiPromise } from '@vertexade/platform-server/effect'
import type { DrizzleDashboardDatabase } from './database/dashboard-database.ts'
import {
  decodePromptImage,
  MAX_PROMPT_IMAGES,
  MAX_PROMPT_IMAGE_REQUEST_BYTES,
  promptImageFileName,
  readPromptImage,
  storePromptImages,
} from './prompt-images.ts'
import { operationalHealth } from './operational-health.ts'
import { liveness, readiness } from './service-health.ts'
import { createSetupStatus, inspectSetupTools, type ToolSpec } from './setup-status.ts'
import type { SystemConfiguration } from './settings/system-configuration.ts'

type JsonResponse = (status: number, value: unknown) => Response
type ReadBody = (request: Request, maxBytes?: number) => Promise<any>
type Runner = Parameters<typeof inspectSetupTools>[0]
type WorkspacePreviewSettings = { domain: string; gatewayPort: number }

type SetupExtension = {
  id: string
  name: string
  lifecycle: string
  enabled: boolean
  configured?: boolean
  setupChecks?: ToolSpec[]
}

type SetupAgent = {
  id: string
  name: string
  enabled: boolean
  moduleId?: string
}

type SetupScm = {
  id: string
  name: string
  authentication?: () => unknown
}

export type CoreRouteDependencies = {
  database: DrizzleDashboardDatabase
  deploymentRecordPath: string
  promptImagesDirectory: string
  systemConfiguration: Pick<SystemConfiguration, 'read' | 'write'>
  workspacePreviews: {
    read(): WorkspacePreviewSettings
    write(input: unknown): Promise<WorkspacePreviewSettings>
  }
  json: JsonResponse
  readBody: ReadBody
  notify(reason: string): void
  setup: {
    run: Runner
    selectedScm(): SetupScm
    extensions(): SetupExtension[]
    agents(): SetupAgent[]
  }
}

function effectJson<A>(program: ApiEffect<A>, dependencies: Pick<CoreRouteDependencies, 'json'>, status = 200) {
  return runApiEffectResponse(
    program,
    (value) => dependencies.json(status, value),
    (failure) => dependencies.json(failure.status, { error: failure.message }),
  )
}

async function setupStatus(dependencies: CoreRouteDependencies) {
  const moduleCatalog = dependencies.setup.extensions()
  const agentCapabilities = dependencies.setup.agents().map((capability) => ({
    ...capability,
    setupCheckIds: moduleCatalog.find(({ id }) => id === capability.moduleId)?.setupChecks?.map(({ id }) => id) || [],
  }))
  const contributedChecks = moduleCatalog.filter(({ enabled }) => enabled).flatMap(({ setupChecks }) => setupChecks || [])
  const tools = await inspectSetupTools(dependencies.setup.run, contributedChecks)
  const selectedScm = dependencies.setup.selectedScm()
  const authentication = (selectedScm.authentication?.() || {
    source: 'provider',
    connected: true,
    error: '',
    expiresAt: null,
  }) as Record<string, unknown>

  return createSetupStatus({
    tools,
    scm: { id: selectedScm.id, name: selectedScm.name, authentication },
    agents: agentCapabilities,
    extensions: moduleCatalog,
    operations: await operationalHealth(dependencies.database, dependencies.deploymentRecordPath),
  })
}

function healthRoute(request: Request, url: URL, dependencies: CoreRouteDependencies) {
  if (request.method !== 'GET') return null
  if (url.pathname === '/api/health/live') {
    return new Response(JSON.stringify(liveness()), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  if (url.pathname !== '/api/health/ready') return null
  const health = readiness(dependencies.database)
  return new Response(JSON.stringify(health), {
    status: health.ready ? 200 : 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function storedPromptImage(imageName: string, dependencies: CoreRouteDependencies) {
  return runApiEffectResponse(
    readPromptImage(dependencies.promptImagesDirectory, imageName),
    (content) => {
      const contentType = imageName.endsWith('.jpg') ? 'image/jpeg' : `image/${imageName.split('.').at(-1)}`
      return new Response(new Uint8Array(content), {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'private, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
        },
      })
    },
    (failure) => dependencies.json(failure.status, { error: failure.message }),
  )
}

function decodePromptImages(files: unknown[], dependencies: CoreRouteDependencies) {
  try {
    return files.map(decodePromptImage)
  } catch (error) {
    return dependencies.json(400, {
      error: error instanceof Error ? error.message : 'Prompt image is invalid',
    })
  }
}

async function uploadPromptImages(request: Request, dependencies: CoreRouteDependencies) {
  const input = await dependencies.readBody(request, MAX_PROMPT_IMAGE_REQUEST_BYTES)
  const files = Array.isArray(input.files) ? input.files : []
  if (!files.length) return dependencies.json(400, { error: 'Paste or attach at least one image' })
  if (files.length > MAX_PROMPT_IMAGES) {
    return dependencies.json(400, {
      error: `A prompt can contain up to ${MAX_PROMPT_IMAGES} images`,
    })
  }
  const decoded = decodePromptImages(files, dependencies)
  if (decoded instanceof Response) return decoded
  return runApiEffectResponse(
    storePromptImages(dependencies.promptImagesDirectory, decoded),
    (images) => dependencies.json(201, { images }),
    (failure) => dependencies.json(failure.status, { error: failure.message }),
  )
}

async function promptImageRoute(request: Request, url: URL, dependencies: CoreRouteDependencies) {
  const imageName = promptImageFileName(url.pathname)
  if (request.method === 'GET' && imageName) return storedPromptImage(imageName, dependencies)
  if (request.method === 'POST' && url.pathname === '/api/prompt-images') {
    return uploadPromptImages(request, dependencies)
  }
  return null
}

async function writeSystemConfiguration(request: Request, dependencies: CoreRouteDependencies) {
  const invalidConfiguration = {
    kind: 'validation' as const,
    message: 'Invalid system configuration',
    status: 400,
    code: 'INVALID_SYSTEM_CONFIGURATION',
    causeMessage: 'replace' as const,
  }
  const program = Effect.gen(function* () {
    const input = yield* tryApiPromise(() => dependencies.readBody(request, 125_000), invalidConfiguration)
    const value = yield* tryApi(() => dependencies.systemConfiguration.write(input), invalidConfiguration)
    yield* tryApi(() => dependencies.notify('system_configuration_updated'), invalidConfiguration)
    return value
  }).pipe(Effect.withSpan('api.system-configuration.write'))

  return effectJson(program, dependencies)
}

async function systemConfigurationRoute(request: Request, url: URL, dependencies: CoreRouteDependencies) {
  if (url.pathname !== '/api/settings/system-configuration') return null
  if (request.method === 'GET') return dependencies.json(200, dependencies.systemConfiguration.read())
  if (request.method === 'POST') return writeSystemConfiguration(request, dependencies)
  return null
}

async function workspacePreviewSettingsRoute(request: Request, url: URL, dependencies: CoreRouteDependencies) {
  if (url.pathname !== '/api/settings/worktree-previews') return null
  if (request.method === 'GET') return dependencies.json(200, dependencies.workspacePreviews.read())
  if (request.method !== 'POST') return null
  const invalidSettings = {
    kind: 'validation' as const,
    message: 'Invalid worktree preview settings',
    status: 400,
    code: 'INVALID_WORKTREE_PREVIEW_SETTINGS',
    causeMessage: 'replace' as const,
  }
  const program = Effect.gen(function* () {
    const input = yield* tryApiPromise(() => dependencies.readBody(request), invalidSettings)
    return yield* tryApiPromise(() => dependencies.workspacePreviews.write(input), invalidSettings)
  }).pipe(Effect.withSpan('api.worktree-previews.write'))

  return effectJson(program, dependencies)
}

export function createCoreRoutes(dependencies: CoreRouteDependencies) {
  return async function coreRoutes(request: Request, url: URL): Promise<Response | null> {
    const healthResponse = healthRoute(request, url, dependencies)
    if (healthResponse) return healthResponse
    const imageResponse = await promptImageRoute(request, url, dependencies)
    if (imageResponse) return imageResponse
    const configurationResponse = await systemConfigurationRoute(request, url, dependencies)
    if (configurationResponse) return configurationResponse
    const previewSettingsResponse = await workspacePreviewSettingsRoute(request, url, dependencies)
    if (previewSettingsResponse) return previewSettingsResponse
    if (request.method === 'GET' && url.pathname === '/api/setup/status') {
      return dependencies.json(200, await setupStatus(dependencies))
    }
    return null
  }
}

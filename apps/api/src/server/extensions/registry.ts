import {
  validateModuleManifest,
  type DashboardExtension,
  type ExtensionDiagnostic,
  type ExtensionFailurePhase,
  type ModuleCatalogEntry,
  type ModuleInstallationOrigin,
  type ModuleLifecycleState,
} from '@vertexade/platform-contracts'
import { runApiEffect, timeoutApiPromise } from '@vertexade/platform-server/effect'
import { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import { ExtensionRouteRegistry } from '../platform/extension-routes.ts'
import { PlatformProviderRegistries } from '../platform/provider-registry.ts'
import { AgentRegistry } from '../agents/registry.ts'

export type InstalledExtension = {
  extension: DashboardExtension
  enabled: boolean
  source: string
  origin: ModuleInstallationOrigin
  removable: boolean
  checksum?: string
  registered: boolean
  failure?: ExtensionDiagnostic
}

type InstallOptions = {
  enabled?: boolean
  source?: string
  origin?: ModuleInstallationOrigin
  removable?: boolean
  checksum?: string
}

export type ExtensionMigrationStore = {
  applied(moduleId: string): number[]
  record(moduleId: string, version: number, name: string): void
}

const memoryMigrations = () => {
  const values = new Map<string, number[]>()
  return {
    applied: (moduleId: string) => values.get(moduleId) || [],
    record(moduleId: string, version: number) {
      values.set(moduleId, [...(values.get(moduleId) || []), version])
    },
  }
}

function lifecycle(
  enabled: boolean,
  status: ReturnType<NonNullable<DashboardExtension['status']>>,
  failure?: ExtensionDiagnostic,
): ModuleLifecycleState {
  if (failure) return 'failed'
  if (!enabled) return 'disabled'
  if (status.healthy === false) return 'degraded'
  if (status.configured === false) return 'setup-required'
  return 'ready'
}

function runExtensionOperation(operation: () => PromiseLike<unknown> | unknown, label: string) {
  return runApiEffect(
    timeoutApiPromise(
      () => Promise.resolve().then(operation),
      30_000,
      {
        kind: 'unexpected',
        message: `${label} failed`,
        status: 500,
        code: 'EXTENSION_OPERATION_FAILED',
        causeMessage: 'replace',
      },
      {
        kind: 'unavailable',
        message: `${label} timed out after 30000ms`,
        status: 503,
        code: 'EXTENSION_OPERATION_TIMEOUT',
      },
    ),
  )
}

async function runLifecycle(extension: DashboardExtension, enabled: boolean) {
  const hook = enabled ? extension.initialize : extension.dispose
  if (!hook) return
  const operation = enabled ? 'initialization' : 'disposal'
  await runExtensionOperation(hook, `${extension.manifest.id} ${operation}`)
}

export class ExtensionRegistry {
  #extensions = new Map<string, InstalledExtension>()
  #registering = new Set<string>()
  #loadDiagnostics: ExtensionDiagnostic[] = []
  readonly contributions: PlatformCapabilityRegistries
  readonly providers: PlatformProviderRegistries
  readonly routes: ExtensionRouteRegistry
  readonly agents: AgentRegistry

  constructor(private readonly migrationStore: ExtensionMigrationStore = memoryMigrations()) {
    const isEnabled = (moduleId: string) => {
      if (moduleId === 'core') return true
      const installed = this.#extensions.get(moduleId)
      return Boolean(installed?.enabled && !installed.failure)
    }
    this.contributions = new PlatformCapabilityRegistries(isEnabled)
    this.providers = new PlatformProviderRegistries(isEnabled)
    this.routes = new ExtensionRouteRegistry(isEnabled)
    this.agents = new AgentRegistry(isEnabled)
  }

  install(
    extension: DashboardExtension,
    { enabled = false, source = 'local', origin = 'local', removable = false, checksum }: InstallOptions = {},
  ) {
    validateModuleManifest(extension?.manifest)
    const { id } = extension.manifest
    if (this.#extensions.has(id)) throw new Error(`Extension already installed: ${id}`)
    const migrations = extension.migrations || []
    if (migrations.some((migration) => !Number.isInteger(migration.version) || migration.version < 1 || !migration.name.trim()))
      throw new Error(`${id} has an invalid extension migration`)
    if (new Set(migrations.map((migration) => migration.version)).size !== migrations.length)
      throw new Error(`${id} declares an extension migration version more than once`)
    this.#extensions.set(id, {
      extension: Object.freeze(extension),
      enabled,
      source,
      origin,
      removable,
      registered: false,
      ...(checksum ? { checksum } : {}),
    })
    return this
  }

  async migrate(id: string) {
    const installed = this.#extensions.get(id)
    if (!installed) throw new Error(`Extension is not installed: ${id}`)
    const applied = new Set(this.migrationStore.applied(id))
    try {
      for (const migration of [...(installed.extension.migrations || [])].sort((left, right) => left.version - right.version)) {
        if (applied.has(migration.version)) continue
        await runExtensionOperation(() => migration.migrate(), `${id} migration ${migration.version}`)
        this.migrationStore.record(id, migration.version, migration.name)
      }
      if (installed.failure?.phase === 'migration') installed.failure = undefined
      return installed
    } catch (error) {
      this.fail(id, 'migration', error)
      throw error
    }
  }

  async register(id: string) {
    const installed = this.#extensions.get(id)
    if (!installed) throw new Error(`Extension is not installed: ${id}`)
    if (installed.registered) return installed
    if (this.#registering.has(id)) throw new Error(`Extension part dependency cycle includes ${id}`)
    this.#registering.add(id)
    try {
      await this.#registerDependencies(installed)
      const capabilities = this.contributions.forModule(id)
      const registration = installed.extension.register?.({
        ...capabilities,
        primitives: {
          register: (primitive) => {
            this.contributions.registerPrimitive(id, primitive)
          },
        },
        providers: this.providers.forModule(id),
        agents: this.agents.forModule(id),
        routes: {
          register: (route) => {
            this.routes.register(id, route)
          },
        },
      })
      if (registration) {
        await runExtensionOperation(() => registration, `${id} registration`)
      }
      const registered = this.contributions.declarations(id)
      for (const kind of ['actions', 'queries', 'transforms', 'gates', 'evidence', 'triggers'] as const) {
        const declared = (installed.extension.manifest.contributes?.[kind] || []).map((capability) => capability.id).sort()
        if (declared.join('\n') !== registered[kind].join('\n')) {
          throw new Error(`${id} ${kind} manifest declarations do not match its registered capabilities`)
        }
      }
      const declaredPrimitives = (installed.extension.manifest.primitives || [])
        .map(({ id: primitiveId }) => primitiveId)
        .sort((left, right) => left.localeCompare(right))
      if (declaredPrimitives.join('\n') !== registered.primitives.join('\n')) {
        throw new Error(`${id} primitive manifest declarations do not match its registered primitives`)
      }
      const declaredCustom = installed.extension.manifest.contributes?.custom || {}
      const customKinds = new Set([...Object.keys(declaredCustom), ...Object.keys(registered.custom)])
      for (const kind of customKinds) {
        const declared = (declaredCustom[kind] || []).map(({ id: capabilityId }) => capabilityId).sort()
        if (declared.join('\n') !== (registered.custom[kind] || []).join('\n')) {
          throw new Error(`${id} ${kind} manifest declarations do not match its registered capabilities`)
        }
      }
      const declaredProviders = (installed.extension.manifest.providers || []).map((provider) => `${provider.kind}:${provider.id}`).sort()
      if (declaredProviders.join('\n') !== this.providers.declarations(id).join('\n')) {
        throw new Error(`${id} provider manifest declarations do not match its registered providers`)
      }
      const declaredAgents = (installed.extension.manifest.agents || []).map((agent) => agent.id).sort()
      if (declaredAgents.join('\n') !== this.agents.declarations(id).join('\n')) {
        throw new Error(`${id} agent manifest declarations do not match its registered agents`)
      }
      installed.registered = true
      if (installed.failure?.phase === 'register') installed.failure = undefined
      return installed
    } catch (error) {
      this.contributions.removeModule(id)
      this.providers.removeModule(id)
      this.routes.removeModule(id)
      this.agents.removeModule(id)
      this.fail(id, 'register', error)
      throw error
    } finally {
      this.#registering.delete(id)
    }
  }

  async #registerDependencies(installed: InstalledExtension) {
    const requirements = installed.extension.manifest.requires?.parts
    if (!requirements) return
    const owners = new Set<string>()
    const findOwner = (description: string, predicate: (candidate: InstalledExtension) => boolean) => {
      const owner = [...this.#extensions.values()].find(predicate)
      if (!owner) throw new Error(`${installed.extension.manifest.id} requires missing ${description}`)
      if (owner.extension.manifest.id !== installed.extension.manifest.id) owners.add(owner.extension.manifest.id)
    }
    for (const primitive of requirements.primitives || []) {
      findOwner(`primitive ${primitive}`, ({ extension }) => (extension.manifest.primitives || []).some(({ id }) => id === primitive))
    }
    for (const capability of requirements.capabilities || []) {
      findOwner(`capability ${capability}`, ({ extension }) =>
        Object.values(extension.manifest.contributes || {}).some((value) => {
          if (Array.isArray(value)) return value.some(({ id }) => id === capability)
          return Object.values(value || {}).some((items) => items.some(({ id }) => id === capability))
        }),
      )
    }
    for (const provider of requirements.providers || []) {
      findOwner(`provider ${provider.kind}:${provider.id}`, ({ extension }) =>
        (extension.manifest.providers || []).some((candidate) => candidate.kind === provider.kind && candidate.id === provider.id),
      )
    }
    for (const owner of owners) await this.register(owner)
  }

  fail(id: string, phase: ExtensionFailurePhase, error: unknown) {
    const diagnostic = {
      moduleId: id,
      phase,
      message: error instanceof Error ? error.message : String(error),
    }
    const installed = this.#extensions.get(id)
    if (installed) installed.failure = diagnostic
    else this.#loadDiagnostics.push(diagnostic)
    return diagnostic
  }

  diagnose(id: string, phase: ExtensionFailurePhase, error: unknown) {
    const diagnostic = {
      moduleId: id,
      phase,
      message: error instanceof Error ? error.message : String(error),
    }
    this.#loadDiagnostics.push(diagnostic)
    return diagnostic
  }

  diagnostics() {
    return [...this.#loadDiagnostics, ...[...this.#extensions.values()].flatMap(({ failure }) => (failure ? [failure] : []))]
  }

  installed(): InstalledExtension[]
  installed(id: string): InstalledExtension | null
  installed(id?: string): InstalledExtension[] | InstalledExtension | null {
    if (id) return this.#extensions.get(id) || null
    return [...this.#extensions.values()]
  }

  enable(id: string, enabled: boolean) {
    const installed = this.#extensions.get(id)
    if (!installed) throw new Error(`Extension is not installed: ${id}`)
    installed.enabled = enabled
    return installed
  }

  async setEnabled(id: string, enabled: boolean) {
    const installed = this.#extensions.get(id)
    if (!installed) throw new Error(`Extension is not installed: ${id}`)
    const retryFailedLifecycle = installed.failure && ['initialize', 'dispose'].includes(installed.failure.phase)
    if (installed.enabled === enabled && !retryFailedLifecycle) return installed
    const phase = enabled ? 'initialize' : 'dispose'
    try {
      await runLifecycle(installed.extension, enabled)
      if (installed.failure && ['initialize', 'dispose'].includes(installed.failure.phase)) installed.failure = undefined
    } catch (error) {
      this.fail(id, phase, error)
      throw error
    }
    installed.enabled = enabled
    return installed
  }

  require(id: string) {
    const installed = this.#extensions.get(id)
    if (!installed) throw new Error(`Extension is not installed: ${id}`)
    if (installed.failure)
      throw new Error(
        `${installed.extension.manifest.name} extension failed during ${installed.failure.phase}: ${installed.failure.message}`,
      )
    if (!installed.enabled) throw new Error(`${installed.extension.manifest.name} extension is disabled`)
    return installed.extension
  }

  capabilities() {
    return [...this.#extensions.values()].map((installed) => {
      const { extension, enabled, source, origin, removable, checksum } = installed
      const status = this.#status(installed)
      return {
        ...extension.manifest,
        installed: true,
        enabled,
        source,
        installation: { origin, removable, ...(checksum ? { checksum } : {}) },
        lifecycle: lifecycle(enabled, status, installed.failure),
        ...(installed.failure ? { failure: installed.failure } : {}),
        ...status,
      }
    })
  }

  catalog(): ModuleCatalogEntry[] {
    return [...this.#extensions.values()].map((installed) => {
      const { extension, enabled, origin, removable, checksum } = installed
      const status = this.#status(installed)
      return {
        ...extension.manifest,
        installed: true,
        enabled,
        installation: { origin, removable, ...(checksum ? { checksum } : {}) },
        lifecycle: lifecycle(enabled, status, installed.failure),
        ...(installed.failure ? { failure: installed.failure } : {}),
        ...status,
      }
    })
  }

  async initialize() {
    for (const installed of this.#extensions.values()) {
      if (!installed.enabled || installed.failure) continue
      try {
        await installed.extension.initialize?.()
      } catch (error) {
        this.fail(installed.extension.manifest.id, 'initialize', error)
      }
    }
  }

  async dispose() {
    for (const installed of [...this.#extensions.values()].reverse()) {
      if (!installed.enabled) continue
      try {
        await installed.extension.dispose?.()
      } catch (error) {
        this.fail(installed.extension.manifest.id, 'dispose', error)
      }
    }
  }

  #status(installed: InstalledExtension) {
    try {
      const status = installed.extension.status?.() || {}
      if (installed.failure?.phase === 'status') installed.failure = undefined
      return status
    } catch (error) {
      const diagnostic = this.fail(installed.extension.manifest.id, 'status', error)
      return { healthy: false, message: diagnostic.message }
    }
  }
}

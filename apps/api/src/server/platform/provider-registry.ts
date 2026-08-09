import type {
  DeploymentProvider,
  ExtensionProvider,
  FindingsProvider,
  InboxProvider,
  ProviderKind,
  RecordsProvider,
  ScmProvider,
  SearchProvider,
  ScopedProviderRegistries,
  WorkReferenceProvider,
  WorkManagementProvider,
} from '@vertexade/platform-contracts'

type ProviderByKind = {
  scm: ScmProvider
  'work-management': WorkManagementProvider
  records: RecordsProvider
  findings: FindingsProvider
  deployment: DeploymentProvider
  'work-reference': WorkReferenceProvider
  inbox: InboxProvider
  search: SearchProvider
}

type OwnedProvider<TProvider extends ExtensionProvider = ExtensionProvider> = TProvider & {
  moduleId: string
}

class ProviderRegistry<TProvider extends ExtensionProvider = ExtensionProvider> {
  readonly #kind: ProviderKind
  readonly #isModuleEnabled: (moduleId: string) => boolean
  readonly #providers = new Map<string, Readonly<OwnedProvider<TProvider>>>()

  constructor(kind: ProviderKind, isModuleEnabled: (moduleId: string) => boolean) {
    this.#kind = kind
    this.#isModuleEnabled = isModuleEnabled
  }

  register(moduleId: string, provider: TProvider) {
    if (!provider.id?.trim() || !provider.name?.trim()) throw new Error(`${this.#kind} providers require an id and name`)
    if (this.#providers.has(provider.id)) throw new Error(`${this.#kind} provider already registered: ${provider.id}`)
    this.#providers.set(provider.id, Object.freeze({ ...provider, moduleId }))
  }

  get(id: string) {
    return this.#providers.get(id) || null
  }

  require(id: string) {
    const provider = this.get(id)
    if (!provider) throw new Error(`Unknown ${this.#kind} provider: ${id}`)
    if (!this.#isModuleEnabled(provider.moduleId)) throw new Error(`${provider.moduleId} module is disabled`)
    return provider
  }

  ids(moduleId: string) {
    return [...this.#providers.values()]
      .filter((provider) => provider.moduleId === moduleId)
      .map((provider) => provider.id)
      .sort((left, right) => left.localeCompare(right))
  }

  capabilities() {
    return [...this.#providers.values()].map(({ id, name, moduleId }) => ({
      id,
      name,
      kind: this.#kind,
      moduleId,
      enabled: this.#isModuleEnabled(moduleId),
    }))
  }

  available() {
    return [...this.#providers.values()].filter((provider) => this.#isModuleEnabled(provider.moduleId))
  }

  removeModule(moduleId: string) {
    for (const [id, provider] of this.#providers) if (provider.moduleId === moduleId) this.#providers.delete(id)
  }
}

export class PlatformProviderRegistries {
  readonly #registries = new Map<ProviderKind, ProviderRegistry>()
  readonly #isModuleEnabled: (moduleId: string) => boolean
  readonly scm: ProviderRegistry<ScmProvider>
  readonly workManagement: ProviderRegistry<WorkManagementProvider>
  readonly records: ProviderRegistry<RecordsProvider>
  readonly findings: ProviderRegistry<FindingsProvider>
  readonly deployment: ProviderRegistry<DeploymentProvider>
  readonly workReferences: ProviderRegistry<WorkReferenceProvider>
  readonly inbox: ProviderRegistry<InboxProvider>
  readonly search: ProviderRegistry<SearchProvider>

  constructor(isModuleEnabled: (moduleId: string) => boolean = () => true) {
    this.#isModuleEnabled = isModuleEnabled
    this.scm = this.forKind<ScmProvider>('scm')
    this.workManagement = this.forKind<WorkManagementProvider>('work-management')
    this.records = this.forKind<RecordsProvider>('records')
    this.findings = this.forKind<FindingsProvider>('findings')
    this.deployment = this.forKind<DeploymentProvider>('deployment')
    this.workReferences = this.forKind<WorkReferenceProvider>('work-reference')
    this.inbox = this.forKind<InboxProvider>('inbox')
    this.search = this.forKind<SearchProvider>('search')
  }

  forKind<TProvider extends ExtensionProvider = ExtensionProvider>(kind: ProviderKind): ProviderRegistry<TProvider> {
    let registry = this.#registries.get(kind)
    if (!registry) {
      registry = new ProviderRegistry(kind, this.#isModuleEnabled)
      this.#registries.set(kind, registry)
    }
    return registry as ProviderRegistry<TProvider>
  }

  forModule(moduleId: string): ScopedProviderRegistries {
    const register = <TProvider extends ExtensionProvider>(kind: ProviderKind, provider: TProvider) => {
      this.forKind<TProvider>(kind).register(moduleId, provider)
    }
    return {
      register,
      scm: {
        register: (provider) => {
          register('scm', provider)
        },
      },
      workManagement: {
        register: (provider) => {
          register('work-management', provider)
        },
      },
      records: {
        register: (provider) => {
          register('records', provider)
        },
      },
      findings: {
        register: (provider) => {
          register('findings', provider)
        },
      },
      deployment: {
        register: (provider) => {
          register('deployment', provider)
        },
      },
      workReferences: {
        register: (provider) => {
          register('work-reference', provider)
        },
      },
      inbox: {
        register: (provider) => {
          register('inbox', provider)
        },
      },
      search: {
        register: (provider) => {
          register('search', provider)
        },
      },
    }
  }

  declarations(moduleId: string) {
    return [...this.#registries.entries()].flatMap(([kind, registry]) => registry.ids(moduleId).map((id) => `${kind}:${id}`)).sort()
  }

  capabilities() {
    return [...this.#registries.values()].flatMap((registry) => registry.capabilities())
  }

  removeModule(moduleId: string) {
    for (const registry of this.#registries.values()) registry.removeModule(moduleId)
  }
}

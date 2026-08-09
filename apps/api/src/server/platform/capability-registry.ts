import type {
  ActionCapability,
  CapabilityPrimitiveDeclaration,
  CustomCapability,
  CapabilityDeclaration,
  EvidenceCapability,
  GateCapability,
  QueryCapability,
  ScopedCapabilityRegistries,
  TransformCapability,
  TriggerCapability,
} from '@vertexade/platform-contracts'

type OwnedCapability = CapabilityDeclaration & { moduleId: string }

const capabilityIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

class CapabilityRegistry<T extends OwnedCapability> {
  readonly #kind: string
  readonly #isModuleEnabled: (moduleId: string) => boolean
  readonly #entries = new Map<string, Readonly<T>>()

  constructor(kind: string, isModuleEnabled: (moduleId: string) => boolean = () => true) {
    this.#kind = kind
    this.#isModuleEnabled = isModuleEnabled
  }

  register(capability: T) {
    if (!capabilityIdPattern.test(capability.id)) throw new Error(`${this.#kind} capabilities require a dot or kebab-case id`)
    if (!capability.name?.trim()) throw new Error(`${capability.id} requires a name`)
    if (!capability.moduleId?.trim()) throw new Error(`${capability.id} requires an owning module`)
    if (this.#entries.has(capability.id)) throw new Error(`${this.#kind} capability already registered: ${capability.id}`)
    this.#entries.set(capability.id, Object.freeze({ ...capability }))
    return this
  }

  get(id: string) {
    return this.#entries.get(id) || null
  }

  require(id: string) {
    const capability = this.get(id)
    if (!capability) throw new Error(`Unknown ${this.#kind} capability: ${id}`)
    if (!this.#isModuleEnabled(capability.moduleId)) throw new Error(`${capability.moduleId} module is disabled`)
    return capability
  }

  ids(moduleId: string) {
    return [...this.#entries.values()]
      .filter((entry) => entry.moduleId === moduleId)
      .map((entry) => entry.id)
      .sort((left, right) => left.localeCompare(right))
  }

  capabilities() {
    return [...this.#entries.values()].map(({ id, name, description, moduleId, inputSchema, outputSchema, timeoutMs, retry }) => ({
      id,
      name,
      moduleId,
      enabled: this.#isModuleEnabled(moduleId),
      ...(description ? { description } : {}),
      ...(inputSchema ? { inputSchema } : {}),
      ...(outputSchema ? { outputSchema } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(retry ? { retry } : {}),
    }))
  }

  removeModule(moduleId: string) {
    for (const [id, entry] of this.#entries) if (entry.moduleId === moduleId) this.#entries.delete(id)
  }
}

type OwnedAction = ActionCapability & { moduleId: string }
type OwnedQuery = QueryCapability & { moduleId: string }
type OwnedTransform = TransformCapability & { moduleId: string }
type OwnedGate = GateCapability & { moduleId: string }
type OwnedEvidence = EvidenceCapability & { moduleId: string }
type OwnedTrigger = TriggerCapability & { moduleId: string }
type OwnedCustom = CustomCapability & { moduleId: string }
type OwnedPrimitive = CapabilityPrimitiveDeclaration & { moduleId: string }

export class PlatformCapabilityRegistries {
  readonly #isModuleEnabled: (moduleId: string) => boolean
  readonly actions: CapabilityRegistry<OwnedAction>
  readonly queries: CapabilityRegistry<OwnedQuery>
  readonly transforms: CapabilityRegistry<OwnedTransform>
  readonly gates: CapabilityRegistry<OwnedGate>
  readonly evidence: CapabilityRegistry<OwnedEvidence>
  readonly triggers: CapabilityRegistry<OwnedTrigger>
  readonly #custom = new Map<string, CapabilityRegistry<OwnedCustom>>()
  readonly #primitives = new Map<string, Readonly<OwnedPrimitive>>()

  constructor(isModuleEnabled: (moduleId: string) => boolean = () => true) {
    this.#isModuleEnabled = isModuleEnabled
    this.actions = new CapabilityRegistry('action', isModuleEnabled)
    this.queries = new CapabilityRegistry('query', isModuleEnabled)
    this.transforms = new CapabilityRegistry('transform', isModuleEnabled)
    this.gates = new CapabilityRegistry('gate', isModuleEnabled)
    this.evidence = new CapabilityRegistry('evidence', isModuleEnabled)
    this.triggers = new CapabilityRegistry('trigger', isModuleEnabled)
  }

  forModule(moduleId: string): ScopedCapabilityRegistries {
    return {
      actions: {
        register: (capability) => {
          this.actions.register({ ...capability, moduleId })
        },
      },
      queries: {
        register: (capability) => {
          this.queries.register({ ...capability, moduleId })
        },
      },
      transforms: {
        register: (capability) => {
          this.transforms.register({ ...capability, moduleId })
        },
      },
      gates: {
        register: (capability) => {
          this.gates.register({ ...capability, moduleId })
        },
      },
      evidence: {
        register: (capability) => {
          this.evidence.register({ ...capability, moduleId })
        },
      },
      triggers: {
        register: (capability) => {
          this.triggers.register({ ...capability, moduleId })
        },
      },
      custom: {
        register: (kind, capability) => {
          const primitive = this.#primitives.get(kind)
          if (!primitive) throw new Error(`Unknown capability primitive: ${kind}`)
          const registry = this.#custom.get(kind) || new CapabilityRegistry<OwnedCustom>(kind, this.#isModuleEnabled)
          if (!this.#custom.has(kind)) this.#custom.set(kind, registry)
          registry.register({ ...capability, moduleId })
        },
      },
    }
  }

  registerPrimitive(moduleId: string, primitive: CapabilityPrimitiveDeclaration) {
    if (!capabilityIdPattern.test(primitive.id) || !primitive.name?.trim())
      throw new Error('Capability primitives require a valid id and name')
    if (this.#primitives.has(primitive.id)) throw new Error(`Capability primitive already registered: ${primitive.id}`)
    this.#primitives.set(primitive.id, Object.freeze({ ...primitive, moduleId }))
  }

  primitive(id: string) {
    return this.#primitives.get(id) || null
  }

  custom(kind: string) {
    return this.#custom.get(kind) || null
  }

  requireCustom(kind: string, id: string) {
    const primitive = this.#primitives.get(kind)
    if (!primitive) throw new Error(`Unknown capability primitive: ${kind}`)
    if (!this.#isModuleEnabled(primitive.moduleId)) throw new Error(`${primitive.moduleId} module is disabled`)
    const registry = this.#custom.get(kind)
    if (!registry) throw new Error(`Unknown ${kind} capability: ${id}`)
    return registry.require(id)
  }

  removeModule(moduleId: string) {
    this.actions.removeModule(moduleId)
    this.queries.removeModule(moduleId)
    this.transforms.removeModule(moduleId)
    this.gates.removeModule(moduleId)
    this.evidence.removeModule(moduleId)
    this.triggers.removeModule(moduleId)
    for (const registry of this.#custom.values()) registry.removeModule(moduleId)
    for (const [id, primitive] of this.#primitives) if (primitive.moduleId === moduleId) this.#primitives.delete(id)
  }

  declarations(moduleId: string) {
    return {
      actions: this.actions.ids(moduleId),
      queries: this.queries.ids(moduleId),
      transforms: this.transforms.ids(moduleId),
      gates: this.gates.ids(moduleId),
      evidence: this.evidence.ids(moduleId),
      triggers: this.triggers.ids(moduleId),
      custom: Object.fromEntries([...this.#custom].map(([kind, registry]) => [kind, registry.ids(moduleId)])),
      primitives: [...this.#primitives.values()]
        .filter((primitive) => primitive.moduleId === moduleId)
        .map((primitive) => primitive.id)
        .sort(),
    }
  }

  capabilities() {
    return {
      actions: this.actions.capabilities(),
      queries: this.queries.capabilities(),
      transforms: this.transforms.capabilities(),
      gates: this.gates.capabilities(),
      evidence: this.evidence.capabilities(),
      triggers: this.triggers.capabilities(),
      custom: Object.fromEntries([...this.#custom].map(([kind, registry]) => [kind, registry.capabilities()])),
      primitives: [...this.#primitives.values()].map(({ id, name, description, moduleId }) => ({
        id,
        name,
        moduleId,
        enabled: this.#isModuleEnabled(moduleId),
        ...(description ? { description } : {}),
      })),
    }
  }
}

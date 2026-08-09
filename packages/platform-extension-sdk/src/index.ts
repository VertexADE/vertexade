import {
  PORTABLE_SURFACE_API_VERSION,
  validateModuleManifest,
  validatePortableSettings,
  validatePortableSurface,
  type ActionCapability,
  type CapabilityPrimitiveDeclaration,
  type CapabilitySchema,
  type DashboardExtension,
  type CustomCapability,
  type EvidenceCapability,
  type GateCapability,
  type QueryCapability,
  type TransformCapability,
  type ModuleManifest,
  type PortableCollectionSurface,
  type PortableItemAction,
  type PortableSettingsSurface,
  type TriggerCapability,
} from '@vertexade/platform-contracts'

export function defineExtension<TExtension extends DashboardExtension>(extension: TExtension): TExtension {
  extensionConformance(extension)
  return extension
}

export function defineManifest<TManifest extends ModuleManifest>(manifest: TManifest): TManifest {
  validateModuleManifest(manifest)
  return manifest
}

export function definePortableCollection<const TSurface extends Omit<PortableCollectionSurface, 'contractVersion' | 'kind'>>(
  surface: TSurface,
): TSurface & Pick<PortableCollectionSurface, 'contractVersion' | 'kind'> {
  const definition = {
    contractVersion: PORTABLE_SURFACE_API_VERSION,
    kind: 'collection' as const,
    ...surface,
  }
  validatePortableSurface(definition)
  return definition
}

export function definePortableSettings<const TSettings extends Omit<PortableSettingsSurface, 'contractVersion'>>(
  settings: TSettings,
): TSettings & Pick<PortableSettingsSurface, 'contractVersion'> {
  const definition = {
    contractVersion: PORTABLE_SURFACE_API_VERSION,
    ...settings,
  }
  validatePortableSettings(definition)
  return definition
}

export function defineAgentEnvironmentSettings(agentName: string) {
  return definePortableSettings({
    id: 'settings',
    title: `${agentName} environment`,
    description: `Configure encrypted environment variables used only when ${agentName} starts.`,
    source: { path: '/settings', configuredPath: 'configured' },
    fields: [
      {
        name: 'variables',
        label: 'Environment variables',
        type: 'object-list',
        valuePath: 'agent.variables',
        maxItems: 100,
        addLabel: 'Add variable',
        allowReorder: true,
        fields: [
          {
            name: 'name',
            label: 'Name',
            type: 'text',
            required: true,
            placeholder: 'VARIABLE_NAME',
          },
          {
            name: 'value',
            label: 'Value',
            type: 'password',
            storedPath: 'has_value',
            required: true,
          },
          { name: 'previous_name', label: 'Previous name', type: 'hidden', valuePath: 'name' },
        ],
      },
    ],
    submit: {
      method: 'POST',
      path: '/settings',
      label: 'Save environment',
      successMessage: `${agentName} environment saved.`,
    },
  })
}

export function definePortableFindingsCollection(input: {
  id: string
  title: string
  description: string
  setupMessage: string
  refreshEventPrefix: string
  actions?: PortableItemAction[]
}) {
  return definePortableCollection({
    id: input.id,
    title: input.title,
    description: input.description,
    source: {
      path: '/findings',
      configuredPath: 'configured',
      itemsPath: 'findings',
    },
    item: {
      idPath: 'id',
      titlePath: 'portable_title',
      fieldsPath: 'portable_fields',
      fieldNamePath: 'name',
      fieldValuePath: 'value',
      fieldStylePath: 'style',
      fieldPlacementPath: 'placement',
      relationItemsPath: 'relation.items',
      relationIdPath: 'id',
      relationTitlePath: 'title',
      relationUrlPath: 'url',
    },
    views: {
      list: true,
      kanban: {
        enabled: true,
        groupFieldsPath: 'portable_group_fields',
        groupFieldNamePath: 'field',
      },
    },
    facets: [
      { id: 'severity', label: 'Severity', field: 'Severity' },
      { id: 'status', label: 'Status', field: 'Status' },
      { id: 'project', label: 'Project', field: 'Project' },
      { id: 'type', label: 'Types', field: 'Type' },
    ],
    detail: {
      source: { path: '/findings/{id}' },
    },
    actions: [
      {
        id: 'start-work',
        label: 'Start Work',
        description: 'Launch repository work from this finding.',
        method: 'POST',
        path: '/findings/{id}/thread',
        inputs: [
          {
            name: 'repository_id',
            label: 'Repository',
            type: 'select',
            required: true,
            optionsPath: 'repositories',
            optionValuePath: 'id',
            optionLabelPath: 'full_name',
          },
          {
            name: 'instruction',
            label: 'Additional instruction',
            type: 'textarea',
          },
          {
            name: 'create_pr',
            label: 'Create a pull request',
            type: 'boolean',
            defaultValue: true,
          },
        ],
        successMessage: 'Remediation work started from the finding.',
        intent: 'launch-work',
      },
      ...(input.actions || []),
    ],
    setup: {
      message: input.setupMessage,
      settingsSurfaceId: 'settings',
    },
    refresh: {
      eventPrefixes: [input.refreshEventPrefix],
    },
  })
}

export function defineAction<TInput, TOutput>(capability: ActionCapability<TInput, TOutput>) {
  return capability
}

export function definePrimitive(primitive: CapabilityPrimitiveDeclaration) {
  return primitive
}

export function defineCustomCapability<TInput, TOutput>(capability: CustomCapability<TInput, TOutput>) {
  return capability
}

export function defineQuery<TInput, TOutput>(capability: QueryCapability<TInput, TOutput>) {
  return capability
}

export function defineTransform<TInput, TOutput>(capability: TransformCapability<TInput, TOutput>) {
  return capability
}

export function defineGate<TInput>(capability: GateCapability<TInput>) {
  return capability
}

export function defineEvidence<TInput>(capability: EvidenceCapability<TInput>) {
  return capability
}

export function defineTrigger(capability: TriggerCapability) {
  return capability
}

export function createTrigger(capability: Omit<TriggerCapability, 'subscribe'>) {
  const listeners = new Set<(event: import('@vertexade/platform-contracts').TriggerEvent) => void>()
  let sequence = 0
  return {
    capability: defineTrigger({
      ...capability,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }),
    emit(event: import('@vertexade/platform-contracts').TriggerEvent) {
      const normalized = {
        ...event,
        id: event.id || `${capability.id}:${Date.now()}:${++sequence}`,
        occurredAt: event.occurredAt || new Date().toISOString(),
      }
      for (const listener of listeners) listener(normalized)
      return normalized
    },
    clear() {
      listeners.clear()
    },
  }
}

export function objectSchema(properties: Record<string, CapabilitySchema>, required: string[] = []): CapabilitySchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function extensionConformance(extension: DashboardExtension, packageVersion?: string) {
  const manifest = validateModuleManifest(extension.manifest)
  if (packageVersion && packageVersion !== manifest.version) {
    throw new Error(`${manifest.id} package version ${packageVersion} does not match manifest version ${manifest.version}`)
  }
  const migrations = extension.migrations || []
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1]!.version >= migrations[index]!.version)
      throw new Error(`${manifest.id} migrations must be ordered by version`)
  }
  return {
    id: manifest.id,
    version: manifest.version,
    permissions: manifest.permissions || [],
    capabilities: Object.fromEntries(
      Object.entries(manifest.contributes || {}).map(([kind, values]) => [
        kind,
        Array.isArray(values)
          ? values.map((value) => value.id)
          : Object.fromEntries(
              Object.entries(values || {}).map(([customKind, capabilities]) => [customKind, capabilities.map((value) => value.id)]),
            ),
      ]),
    ),
    providers: (manifest.providers || []).map((provider) => `${provider.kind}:${provider.id}`),
    migrations: migrations.map(({ version, name }) => ({ version, name })),
  }
}

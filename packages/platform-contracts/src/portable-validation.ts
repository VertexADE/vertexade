import { PORTABLE_SURFACE_API_VERSION } from './core'
import type {
  PortableItemAction,
  PortableModuleManifest,
  PortableSettingsField,
  PortableSettingsSurface,
  PortableSurface,
} from './extension'

const capabilityIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

function requireText(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
}

function requirePortablePath(path: string | undefined, message: string) {
  requireText(path, message)
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path || '')) throw new Error(message)
}

function requirePortableRoute(path: string, message: string, allowItemTemplate = false) {
  requireText(path, message)
  const valid =
    path.startsWith('/') &&
    !path.includes('//') &&
    path
      .split('/')
      .slice(1)
      .every(
        (segment) =>
          Boolean(segment) &&
          segment !== '.' &&
          segment !== '..' &&
          (/^[A-Za-z0-9._~-]+$/.test(segment) || (allowItemTemplate && /^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(segment))),
      )
  if (!valid) throw new Error(message)
}

export function validatePortableSurface(surface: PortableSurface, moduleId = 'extension'): PortableSurface {
  if (surface.contractVersion !== PORTABLE_SURFACE_API_VERSION)
    throw new Error(`${moduleId} portable surface ${surface.id} requires unsupported contract version`)
  if (!capabilityIdPattern.test(surface.id)) throw new Error(`${moduleId} has an invalid portable surface id: ${surface.id}`)
  if (surface.kind !== 'collection') throw new Error(`${moduleId} portable surface ${surface.id} has an unsupported kind`)
  requireText(surface.title, `${moduleId} portable surface ${surface.id} requires a title`)
  requirePortableRoute(surface.source.path, `${moduleId} portable surface ${surface.id} source must use a scoped path`)
  if (surface.source.configuredPath)
    requirePortablePath(surface.source.configuredPath, `${moduleId} portable surface ${surface.id} has an invalid configured path`)
  requirePortablePath(surface.source.itemsPath, `${moduleId} portable surface ${surface.id} has an invalid items path`)
  for (const [label, path] of Object.entries(surface.item)) {
    if (path) requirePortablePath(path, `${moduleId} portable surface ${surface.id} has an invalid ${label}`)
  }
  if (surface.views.kanban) {
    requirePortablePath(
      surface.views.kanban.groupFieldsPath,
      `${moduleId} portable surface ${surface.id} has an invalid Kanban fields path`,
    )
    requirePortablePath(
      surface.views.kanban.groupFieldNamePath,
      `${moduleId} portable surface ${surface.id} has an invalid Kanban field name path`,
    )
  }
  if (surface.views.hierarchy)
    requirePortablePath(
      surface.views.hierarchy.parentIdPath,
      `${moduleId} portable surface ${surface.id} has an invalid hierarchy parent path`,
    )
  if (!surface.views.list && !surface.views.kanban?.enabled)
    throw new Error(`${moduleId} portable surface ${surface.id} requires an enabled view`)
  const actionIds = new Set<string>()
  const validateAction = (action: PortableItemAction, scope: 'item' | 'collection') => {
    if (!capabilityIdPattern.test(action.id) || actionIds.has(action.id))
      throw new Error(`${moduleId} portable surface ${surface.id} has an invalid or duplicate action id: ${action.id}`)
    requireText(action.label, `${moduleId} portable action ${action.id} requires a label`)
    if (!['POST', 'PATCH'].includes(action.method)) throw new Error(`${moduleId} portable action ${action.id} has an unsupported method`)
    requirePortableRoute(action.path, `${moduleId} portable action ${action.id} must use a scoped path`, scope === 'item')
    const inputNames = new Set<string>()
    for (const input of action.inputs || []) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(input.name) || inputNames.has(input.name))
        throw new Error(`${moduleId} portable action ${action.id} has an invalid or duplicate input name`)
      requireText(input.label, `${moduleId} portable action ${action.id} input ${input.name} requires a label`)
      if (!['select', 'multiselect', 'boolean', 'text', 'textarea', 'number', 'hidden'].includes(input.type))
        throw new Error(`${moduleId} portable action ${action.id} input ${input.name} has an unsupported type`)
      if (input.defaultPath)
        requirePortablePath(input.defaultPath, `${moduleId} portable action ${action.id} input ${input.name} has an invalid default path`)
      if (input.type === 'select' || input.type === 'multiselect') {
        if (!input.options?.length) {
          requirePortablePath(input.optionsPath, `${moduleId} portable action ${action.id} input ${input.name} requires options`)
          requirePortablePath(
            input.optionValuePath,
            `${moduleId} portable action ${action.id} input ${input.name} requires an option value`,
          )
          requirePortablePath(
            input.optionLabelPath,
            `${moduleId} portable action ${action.id} input ${input.name} requires an option label`,
          )
        }
        if (input.optionsSource && !['surface', 'item'].includes(input.optionsSource)) {
          throw new Error(`${moduleId} portable action ${action.id} input ${input.name} has an invalid options source`)
        }
        if (input.optionsFilterPath)
          requirePortablePath(
            input.optionsFilterPath,
            `${moduleId} portable action ${action.id} input ${input.name} has an invalid option filter path`,
          )
        if (input.optionsFilterInput && !/^[A-Za-z][A-Za-z0-9_]*$/.test(input.optionsFilterInput))
          throw new Error(`${moduleId} portable action ${action.id} input ${input.name} has an invalid option filter input`)
      }
      for (const segment of input.bodyPath || [])
        requireText(segment, `${moduleId} portable action ${action.id} input ${input.name} has an empty body path segment`)
      inputNames.add(input.name)
    }
    actionIds.add(action.id)
    if (action.job) {
      requirePortablePath(action.job.idPath, `${moduleId} portable action ${action.id} job requires an id path`)
      requirePortableRoute(action.job.statusPath, `${moduleId} portable action ${action.id} job requires a scoped status path`, true)
      requirePortablePath(action.job.statusValuePath, `${moduleId} portable action ${action.id} job requires a status value path`)
      if (action.job.resultPath)
        requirePortablePath(action.job.resultPath, `${moduleId} portable action ${action.id} job has an invalid result path`)
      if (action.job.errorPath)
        requirePortablePath(action.job.errorPath, `${moduleId} portable action ${action.id} job has an invalid error path`)
      if (!action.job.completedValues.length || !action.job.failedValues.length)
        throw new Error(`${moduleId} portable action ${action.id} job requires terminal status values`)
      if (action.job.pollIntervalMs !== undefined && (action.job.pollIntervalMs < 250 || action.job.pollIntervalMs > 60_000))
        throw new Error(`${moduleId} portable action ${action.id} job has an invalid poll interval`)
      if (action.job.completeAction) validateAction(action.job.completeAction, scope)
      if (action.job.refineAction) validateAction(action.job.refineAction, scope)
    }
  }
  for (const action of surface.actions || []) validateAction(action, 'item')
  if (surface.itemActionsPath)
    requirePortablePath(surface.itemActionsPath, `${moduleId} portable surface ${surface.id} has an invalid item actions path`)
  for (const action of surface.collectionActions || []) validateAction(action, 'collection')
  if (surface.collectionActionsPath)
    requirePortablePath(surface.collectionActionsPath, `${moduleId} portable surface ${surface.id} has an invalid collection actions path`)
  for (const facet of surface.facets || []) {
    if (!capabilityIdPattern.test(facet.id)) throw new Error(`${moduleId} portable surface ${surface.id} has an invalid facet id`)
    requireText(facet.label, `${moduleId} portable facet ${facet.id} requires a label`)
    requireText(facet.field, `${moduleId} portable facet ${facet.id} requires a field`)
  }
  for (const control of surface.sourceControls || []) {
    if (!capabilityIdPattern.test(control.id))
      throw new Error(`${moduleId} portable surface ${surface.id} has an invalid source control id`)
    requireText(control.label, `${moduleId} portable source control ${control.id} requires a label`)
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(control.queryParameter))
      throw new Error(`${moduleId} portable source control ${control.id} has an invalid query parameter`)
    requirePortablePath(control.optionsPath, `${moduleId} portable source control ${control.id} requires options`)
    requirePortablePath(control.optionValuePath, `${moduleId} portable source control ${control.id} requires an option value`)
    requirePortablePath(control.optionLabelPath, `${moduleId} portable source control ${control.id} requires an option label`)
    if (control.selectedPath)
      requirePortablePath(control.selectedPath, `${moduleId} portable source control ${control.id} has an invalid selected path`)
  }
  if (surface.views.default === 'kanban' && !surface.views.kanban?.enabled)
    throw new Error(`${moduleId} portable surface ${surface.id} cannot default to disabled Kanban`)
  if (surface.views.pagination?.pageSize !== undefined && surface.views.pagination.pageSize < 1)
    throw new Error(`${moduleId} portable surface ${surface.id} has an invalid collection page size`)
  if (surface.views.kanban?.defaultField)
    requireText(surface.views.kanban.defaultField, `${moduleId} portable surface ${surface.id} requires a default Kanban field`)
  for (const group of surface.views.kanban?.groupOrder || [])
    requireText(group, `${moduleId} portable surface ${surface.id} has an invalid Kanban group order value`)
  if (surface.views.kanban?.groupOrderPath || surface.views.kanban?.groupOrderValuePath) {
    if (!surface.views.kanban.groupOrderPath || !surface.views.kanban.groupOrderValuePath)
      throw new Error(`${moduleId} portable surface ${surface.id} requires both Kanban group order paths`)
    requirePortablePath(
      surface.views.kanban.groupOrderPath,
      `${moduleId} portable surface ${surface.id} has an invalid Kanban group order path`,
    )
    requirePortablePath(
      surface.views.kanban.groupOrderValuePath,
      `${moduleId} portable surface ${surface.id} has an invalid Kanban group order value path`,
    )
  }
  const dynamicGroupOrderPaths = [
    surface.views.kanban?.groupOrderEntriesPath,
    surface.views.kanban?.groupOrderEntryFieldPath,
    surface.views.kanban?.groupOrderEntryValuePath,
  ]
  if (dynamicGroupOrderPaths.some(Boolean)) {
    if (!dynamicGroupOrderPaths.every(Boolean))
      throw new Error(`${moduleId} portable surface ${surface.id} requires all dynamic Kanban group order paths`)
    requirePortablePath(
      surface.views.kanban!.groupOrderEntriesPath!,
      `${moduleId} portable surface ${surface.id} has an invalid dynamic Kanban group order path`,
    )
    requirePortablePath(
      surface.views.kanban!.groupOrderEntryFieldPath!,
      `${moduleId} portable surface ${surface.id} has an invalid dynamic Kanban group order field path`,
    )
    requirePortablePath(
      surface.views.kanban!.groupOrderEntryValuePath!,
      `${moduleId} portable surface ${surface.id} has an invalid dynamic Kanban group order value path`,
    )
  }
  const swimlanes = surface.views.kanban?.swimlanes
  if (swimlanes) {
    const optionIds = new Set<string>()
    if (!swimlanes.options.length) throw new Error(`${moduleId} portable surface ${surface.id} requires at least one swimlane option`)
    for (const option of swimlanes.options) {
      if (!capabilityIdPattern.test(option.id) || optionIds.has(option.id))
        throw new Error(`${moduleId} portable surface ${surface.id} has an invalid or duplicate swimlane option id`)
      requireText(option.label, `${moduleId} portable swimlane option ${option.id} requires a label`)
      if (option.kind === 'field' && !option.field?.trim())
        throw new Error(`${moduleId} portable swimlane option ${option.id} requires a field`)
      if (option.kind === 'hierarchy') {
        if (!surface.views.hierarchy) throw new Error(`${moduleId} portable swimlane option ${option.id} requires hierarchy mapping`)
        if (!option.field?.trim() || !option.anchorValues?.length)
          throw new Error(`${moduleId} portable swimlane option ${option.id} requires a field and anchor values`)
        if (option.nestedLabel !== undefined)
          requireText(option.nestedLabel, `${moduleId} portable swimlane option ${option.id} requires a nested label`)
      }
      if (option.kind !== 'hierarchy' && (option.anchorValues?.length || option.nestedAnchorValues?.length || option.nestedLabel))
        throw new Error(`${moduleId} portable swimlane option ${option.id} cannot declare hierarchy anchors`)
      optionIds.add(option.id)
    }
    if (!optionIds.has(swimlanes.defaultOption))
      throw new Error(`${moduleId} portable surface ${surface.id} has an unknown default swimlane option`)
  }
  if (surface.detail) {
    if (surface.detail.source)
      requirePortableRoute(
        surface.detail.source.path,
        `${moduleId} portable surface ${surface.id} detail source must use a scoped item path`,
        true,
      )
    if (surface.detail.titlePath)
      requirePortablePath(surface.detail.titlePath, `${moduleId} portable surface ${surface.id} has an invalid detail title path`)
    if (surface.detail.sectionsPath)
      requirePortablePath(surface.detail.sectionsPath, `${moduleId} portable surface ${surface.id} has an invalid detail sections path`)
    for (const section of surface.detail.sections || []) {
      if (!capabilityIdPattern.test(section.id))
        throw new Error(`${moduleId} portable surface ${surface.id} has an invalid detail section id`)
      requireText(section.title, `${moduleId} portable detail section ${section.id} requires a title`)
      requirePortablePath(section.path, `${moduleId} portable detail section ${section.id} has an invalid path`)
    }
  }
  if (surface.setup) {
    requireText(surface.setup.message, `${moduleId} portable surface ${surface.id} setup requires a message`)
    if (!capabilityIdPattern.test(surface.setup.settingsSurfaceId))
      throw new Error(`${moduleId} portable surface ${surface.id} setup requires a valid settings surface id`)
  }
  if (surface.refresh) {
    if (!surface.refresh.eventPrefixes.length || surface.refresh.eventPrefixes.some((prefix) => !prefix.trim()))
      throw new Error(`${moduleId} portable surface ${surface.id} requires non-empty refresh prefixes`)
    if (new Set(surface.refresh.eventPrefixes).size !== surface.refresh.eventPrefixes.length)
      throw new Error(`${moduleId} portable surface ${surface.id} has duplicate refresh prefixes`)
  }
  return surface
}

export function validatePortableSettings(settings: PortableSettingsSurface, moduleId = 'extension'): PortableSettingsSurface {
  if (settings.contractVersion !== PORTABLE_SURFACE_API_VERSION)
    throw new Error(`${moduleId} portable settings ${settings.id} requires unsupported contract version`)
  if (!capabilityIdPattern.test(settings.id)) throw new Error(`${moduleId} has an invalid portable settings id: ${settings.id}`)
  requireText(settings.title, `${moduleId} portable settings ${settings.id} requires a title`)
  requirePortableRoute(settings.source.path, `${moduleId} portable settings source must use a scoped path`)
  if (settings.source.configuredPath)
    requirePortablePath(settings.source.configuredPath, `${moduleId} portable settings has an invalid configured path`)
  const actions = new Set<string>()
  for (const action of settings.actions || []) {
    if (!capabilityIdPattern.test(action.id) || actions.has(action.id))
      throw new Error(`${moduleId} portable settings has an invalid or duplicate action id: ${action.id}`)
    requireText(action.label, `${moduleId} portable settings action ${action.id} requires a label`)
    if (!['POST', 'DELETE'].includes(action.method))
      throw new Error(`${moduleId} portable settings action ${action.id} has an unsupported method`)
    requirePortableRoute(action.path, `${moduleId} portable settings action ${action.id} must use a scoped path`)
    if (action.intent === 'reset' && action.method !== 'DELETE')
      throw new Error(`${moduleId} portable settings reset action ${action.id} must use DELETE`)
    actions.add(action.id)
  }
  const validateFields = (fields: PortableSettingsField[], scope: string) => {
    if (!fields.length) throw new Error(`${moduleId} portable settings ${scope} requires at least one field`)
    const names = new Set<string>()
    for (const field of fields) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field.name) || names.has(field.name))
        throw new Error(`${moduleId} portable settings ${scope} has an invalid or duplicate field name: ${field.name}`)
      requireText(field.label, `${moduleId} portable settings field ${field.name} requires a label`)
      if (
        !['text', 'textarea', 'password', 'number', 'boolean', 'select', 'multiselect', 'string-list', 'object-list', 'hidden'].includes(
          field.type,
        )
      ) {
        throw new Error(`${moduleId} portable settings field ${field.name} has an unsupported type`)
      }
      if (field.valuePath)
        requirePortablePath(field.valuePath, `${moduleId} portable settings field ${field.name} has an invalid value path`)
      if (field.storedPath)
        requirePortablePath(field.storedPath, `${moduleId} portable settings field ${field.name} has an invalid stored path`)
      if (field.optionsAction && !actions.has(field.optionsAction))
        throw new Error(`${moduleId} portable settings field ${field.name} references an unknown action`)
      if (field.type === 'select' || field.type === 'multiselect') {
        if (!field.options?.length) {
          requirePortablePath(field.optionsPath, `${moduleId} portable settings field ${field.name} requires options`)
          requirePortablePath(field.optionValuePath, `${moduleId} portable settings field ${field.name} requires an option value`)
          requirePortablePath(field.optionLabelPath, `${moduleId} portable settings field ${field.name} requires an option label`)
        }
        if (field.optionsFilterPath)
          requirePortablePath(
            field.optionsFilterPath,
            `${moduleId} portable settings field ${field.name} has an invalid option filter path`,
          )
        if (field.optionsFilterInput && !/^[A-Za-z][A-Za-z0-9_]*$/.test(field.optionsFilterInput))
          throw new Error(`${moduleId} portable settings field ${field.name} has an invalid option filter input`)
      }
      if (field.type === 'object-list') {
        validateFields(field.fields || [], `${scope}.${field.name}`)
      } else if (field.fields?.length) {
        throw new Error(`${moduleId} portable settings field ${field.name} cannot declare nested fields`)
      }
      if (['multiselect', 'string-list', 'object-list'].includes(field.type)) {
        if (field.minItems !== undefined && field.minItems < 0)
          throw new Error(`${moduleId} portable settings field ${field.name} has an invalid minimum`)
        if (field.maxItems !== undefined && (field.maxItems < 1 || field.maxItems < (field.minItems || 0)))
          throw new Error(`${moduleId} portable settings field ${field.name} has an invalid maximum`)
      } else if (field.minItems !== undefined || field.maxItems !== undefined) {
        throw new Error(`${moduleId} portable settings field ${field.name} cannot declare item limits`)
      }
      names.add(field.name)
    }
    return names
  }
  const fieldNames = validateFields(settings.fields, settings.id)
  if (settings.submit) {
    requireText(settings.submit.label, `${moduleId} portable settings submit requires a label`)
    requirePortableRoute(settings.submit.path, `${moduleId} portable settings submit must use a scoped path`)
  }
  const sectionIds = new Set<string>()
  for (const section of settings.sections || []) {
    if (!capabilityIdPattern.test(section.id) || sectionIds.has(section.id))
      throw new Error(`${moduleId} portable settings has an invalid or duplicate section id: ${section.id}`)
    requireText(section.title, `${moduleId} portable settings section ${section.id} requires a title`)
    if (!section.fields.length || section.fields.some((field) => !fieldNames.has(field)))
      throw new Error(`${moduleId} portable settings section ${section.id} references an unknown field`)
    sectionIds.add(section.id)
  }
  for (const action of settings.actions || []) {
    if (action.includeFields?.some((field) => !fieldNames.has(field)))
      throw new Error(`${moduleId} portable settings action ${action.id} references an unknown field`)
  }
  return settings
}

export function validatePortableManifest(portable: PortableModuleManifest | undefined, moduleId: string) {
  if (!portable) return
  if (!Array.isArray(portable.surfaces)) throw new Error(`${moduleId} portable manifest requires a surfaces array`)
  if (!portable.surfaces.length && !portable.settings) throw new Error(`${moduleId} portable manifest requires a surface or settings`)
  const seen = new Set<string>()
  for (const surface of portable.surfaces) {
    validatePortableSurface(surface, moduleId)
    if (surface.setup && portable.settings?.id !== surface.setup.settingsSurfaceId) {
      throw new Error(`${moduleId} portable surface ${surface.id} references an unavailable settings surface`)
    }
    if (seen.has(surface.id)) throw new Error(`${moduleId} has a duplicate portable surface id: ${surface.id}`)
    seen.add(surface.id)
  }
  if (portable.settings) validatePortableSettings(portable.settings, moduleId)
}

import type { AutomationFlowRun, AutomationRecipe, AutomationThreadAction } from '@vertexade/platform-contracts'
import {
  baseConditionFields,
  draftBoundAction,
  draftCondition,
  draftStep,
  draftWithTrigger,
  promptsForThreadAction,
  recipeTemplates,
  schemaFields,
  updatedSteps,
  type CapabilityOption,
  type CapabilityResponse,
  type ConditionField,
  type DraftStep,
  type RecipeDraft,
  type RecipeTemplate,
} from '@vertexade/ui/components/automation-recipe-editor'
import { newAutomationSchedule } from '@vertexade/ui/components/automation-schedule-editor'

export function automationCapabilities(catalog: CapabilityResponse): CapabilityOption[] {
  const contributions = catalog.contributions
  return [
    ...contributions.actions.map((item) => ({ ...item, kind: 'action' as const })),
    ...contributions.queries.map((item) => ({ ...item, kind: 'query' as const })),
    ...contributions.transforms.map((item) => ({ ...item, kind: 'transform' as const })),
    ...contributions.gates.map((item) => ({ ...item, kind: 'gate' as const })),
    ...contributions.evidence.map((item) => ({ ...item, kind: 'evidence' as const })),
    ...contributions.triggers.map((item) => ({ ...item, kind: 'trigger' as const })),
    ...Object.entries(contributions.custom || {}).flatMap(([kind, items]) => items.map((item) => ({ ...item, kind }))),
  ]
}

export function automationTemplates(catalog: CapabilityResponse): RecipeTemplate[] {
  return [
    ...recipeTemplates,
    ...catalog.modules
      .filter((module) => module.enabled && module.lifecycle !== 'failed')
      .flatMap((module) =>
        (module.ui?.automationTemplates || []).map((template) => ({
          ...template,
          moduleId: module.id,
          moduleName: module.name,
        })),
      ),
  ]
}

export function enabledAutomationTriggers(capabilities: CapabilityOption[]) {
  return capabilities.filter((capability) => capability.kind === 'trigger' && capability.enabled)
}

export function automationConditionFields(trigger: CapabilityOption | undefined): ConditionField[] {
  return [...new Map([...baseConditionFields, ...schemaFields(trigger?.outputSchema)].map((field) => [field.value, field])).values()]
}

export function automationCapabilityChoices(capabilities: CapabilityOption[]) {
  return Object.fromEntries(
    [...new Set(capabilities.filter(({ kind }) => kind !== 'trigger').map(({ kind }) => kind))].map((kind) => [
      kind,
      capabilities.filter((capability) => capability.kind === kind && capability.enabled),
    ]),
  ) as Record<string, CapabilityOption[]>
}

export function automationNames<T extends { id: number; name: string }>(items: T[]) {
  return Object.fromEntries(items.map((item) => [item.id, item.name]))
}

export function visibleAutomationRuns(runs: AutomationFlowRun[], filter: 'approval' | 'history' | undefined) {
  if (filter === 'approval') return runs.filter((run) => run.improvementApprovalStatus === 'pending')
  if (filter === 'history') return runs.filter((run) => run.improvementApprovalStatus !== 'pending')
  return runs
}

export function automationDraftWithStep(draft: RecipeDraft, index: number, value: Partial<DraftStep>) {
  return { ...draft, steps: updatedSteps(draft.steps, index, value) }
}

export function automationDraftWithTrigger(draft: RecipeDraft, triggerId: string, triggers: CapabilityOption[]) {
  const next = draftWithTrigger(
    draft,
    triggerId,
    triggers.find((candidate) => candidate.id === triggerId),
  )
  return {
    ...next,
    schedule: triggerId === 'core.scheduled' ? draft.schedule || newAutomationSchedule() : draft.schedule,
    conditions: triggerId === 'core.scheduled' ? [] : draft.conditions,
  }
}

export function automationDraftWithThreadAction(draft: RecipeDraft, action: AutomationThreadAction) {
  return {
    ...draft,
    threadAction: action,
    promptSteps: promptsForThreadAction(draft, action),
    boundActions: action === 'none' ? [] : draft.boundActions,
  }
}

export function automationDraftWithTemplate(draft: RecipeDraft, template: RecipeTemplate) {
  const triggerId = template.triggerId || draft.triggerId
  return {
    ...draft,
    name: template.name,
    description: template.description,
    triggerId,
    conditionMode: template.conditionMode || 'all',
    conditions: template.conditions?.map(draftCondition) || draft.conditions,
    threadAction: template.threadAction,
    promptSteps: template.promptSteps.map((phase) => ({ ...phase })),
    boundActions: (template.boundActions || []).map(draftBoundAction),
    schedule: triggerId === 'core.scheduled' ? draft.schedule || newAutomationSchedule() : draft.schedule,
    steps: (template.steps || []).map(draftStep),
  } satisfies RecipeDraft
}

export function automationDraftFromRecipe(recipe: AutomationRecipe): RecipeDraft {
  return {
    editingId: recipe.id,
    enabled: recipe.enabled,
    name: recipe.name,
    description: recipe.description,
    triggerId: recipe.triggerId || 'manual',
    conditionMode: recipe.conditionMode,
    conditions: recipe.conditions.map(draftCondition),
    threadAction: recipe.threadAction,
    agentId: recipe.agentId || '',
    model: recipe.model || '',
    reasoningEffort: recipe.reasoningEffort || '',
    serviceTier: recipe.serviceTier || '',
    promptSteps: recipe.promptSteps.map((phase) => ({ ...phase })),
    boundActions: recipe.boundActions.map(draftBoundAction),
    schedule: recipe.schedule,
    steps: recipe.steps.map(draftStep),
  }
}

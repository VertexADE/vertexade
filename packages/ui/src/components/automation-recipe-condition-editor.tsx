import { useEffect, useMemo, useState } from 'react'
import type {
  AutomationCondition,
  AutomationAuditEvent,
  AutomationConditionMode,
  AutomationConditionOperator,
  AutomationFlowRun,
  AutomationRecipe,
  AutomationSchedule,
  AutomationStep,
  AutomationStepInputSource,
  AutomationThreadAction,
  AutomationTemplateContribution,
  CapabilityDeclaration,
  CapabilityExecution,
  CapabilityKind,
  CapabilitySchema,
  CapabilityValue,
  ModuleCatalogEntry,
} from '@vertexade/platform-contracts'
import { Braces, Bot, Filter, GitPullRequest, Pencil, Play, Plus, Power, RotateCcw, Sparkles, Trash2, Workflow, X } from 'lucide-react'
import { toast } from 'sonner'
import { AutomationImprovementApproval } from '@vertexade/ui/components/automation-improvement-approval'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { useReactiveApi } from '@vertexade/ui/hooks/use-reactive-api'
import { age, api, eventReason } from '@vertexade/ui/lib/dashboard-api'
import { cn } from '@vertexade/ui/lib/utils'

export type CapabilityOption = CapabilityDeclaration & {
  moduleId: string
  enabled: boolean
  kind: CapabilityKind | 'trigger'
}
export type CapabilityResponse = {
  contributions: {
    actions: Array<Omit<CapabilityOption, 'kind'>>
    queries: Array<Omit<CapabilityOption, 'kind'>>
    transforms: Array<Omit<CapabilityOption, 'kind'>>
    gates: Array<Omit<CapabilityOption, 'kind'>>
    evidence: Array<Omit<CapabilityOption, 'kind'>>
    triggers: Array<Omit<CapabilityOption, 'kind'>>
    custom: Record<string, Array<Omit<CapabilityOption, 'kind'>>>
  }
  modules: ModuleCatalogEntry[]
}
export type DraftStep = {
  kind: CapabilityKind
  capabilityId: string
  inputSource: AutomationStepInputSource
  input: string
  conditionMode: AutomationConditionMode
  conditions: DraftCondition[]
}
export type DraftCondition = { field: string; operator: AutomationConditionOperator; value: string }
export type DraftPrompt = { name: string; prompt: string }
export type DraftBoundAction = {
  capabilityId: string
  input: string
  conditionMode: AutomationConditionMode
  conditions: DraftCondition[]
}
export type AutomationRuntimeStatus = {
  paused: boolean
  reason: string
  updatedAt: string
  activeRuns: number
  maximumConcurrentRuns: number
}
export type ConditionField = {
  value: string
  label: string
  description?: string
  type?: CapabilitySchema['type']
  options?: string[]
}
export type RecipeDraft = {
  editingId: number | null
  enabled: boolean
  name: string
  description: string
  triggerId: string
  conditionMode: AutomationConditionMode
  conditions: DraftCondition[]
  threadAction: AutomationThreadAction
  agentId: string
  model: string
  reasoningEffort: string
  serviceTier: string
  promptSteps: DraftPrompt[]
  boundActions: DraftBoundAction[]
  schedule: AutomationSchedule | null
  steps: DraftStep[]
}

export const operators: Array<{ value: AutomationConditionOperator; label: string }> = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'in', label: 'is one of' },
  { value: 'not_in', label: 'is not one of' },
  { value: 'greater_than', label: 'is greater than' },
  { value: 'greater_than_or_equal', label: 'is at least' },
  { value: 'less_than', label: 'is less than' },
  { value: 'less_than_or_equal', label: 'is at most' },
  { value: 'exists', label: 'exists' },
  { value: 'not_exists', label: 'does not exist' },
]
export const valueOptional = new Set<AutomationConditionOperator>(['exists', 'not_exists'])
export const operatorGroups: Record<string, Set<AutomationConditionOperator>> = {
  object: new Set(['exists', 'not_exists']),
  number: new Set([
    'equals',
    'not_equals',
    'in',
    'not_in',
    'greater_than',
    'greater_than_or_equal',
    'less_than',
    'less_than_or_equal',
    'exists',
    'not_exists',
  ]),
  options: new Set(['equals', 'not_equals', 'in', 'not_in', 'exists', 'not_exists']),
  string: new Set(['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'exists', 'not_exists']),
}
export const operatorGroupByType: Record<string, string> = {
  object: 'object',
  number: 'number',
  integer: 'number',
}
export const scalarKindByType: Record<string, 'number'> = { number: 'number', integer: 'number' }
export const emptyStep = (): DraftStep => ({
  kind: 'gate',
  capabilityId: '',
  inputSource: 'trigger',
  input: '',
  conditionMode: 'all',
  conditions: [],
})
export const emptyCondition = (): DraftCondition => ({
  field: 'data.reason',
  operator: 'equals',
  value: '',
})
export const emptyPrompt = (): DraftPrompt => ({ name: 'Understand', prompt: '' })
export const emptyBoundAction = (): DraftBoundAction => ({
  capabilityId: '',
  input: '',
  conditionMode: 'all',
  conditions: [],
})
export const draftPullRequestAction = (): DraftBoundAction => ({
  capabilityId: 'core.create-draft-pr',
  input: '',
  conditionMode: 'all',
  conditions: [
    { field: 'thread.status', operator: 'equals', value: 'completed' },
    { field: 'thread.exit_code', operator: 'equals', value: '0' },
  ],
})
export const emptyDraft = (): RecipeDraft => ({
  editingId: null,
  enabled: true,
  name: '',
  description: '',
  triggerId: 'manual',
  conditionMode: 'all',
  conditions: [],
  threadAction: 'none',
  agentId: '',
  model: '',
  reasoningEffort: '',
  serviceTier: '',
  promptSteps: [],
  boundActions: [],
  schedule: null,
  steps: [],
})
export type RecipeTemplate = AutomationTemplateContribution & {
  moduleId: string
  moduleName: string
}

export const recipeTemplates: RecipeTemplate[] = [
  {
    id: 'review',
    moduleId: 'core',
    moduleName: 'VertexADE',
    name: 'Review completed work',
    description: 'Inspect completed work and leave a private review summary.',
    triggerId: '',
    threadAction: 'review',
    promptSteps: [
      {
        name: 'Review',
        prompt:
          'Review the completed changes for correctness, maintainability, security, tests, and user-facing regressions. Prioritize concrete findings and explain the safest next action.',
      },
    ],
  },
  {
    id: 'improve',
    moduleId: 'core',
    moduleName: 'VertexADE',
    name: 'Review and improve',
    description: 'Propose improvements, wait for approval, then implement only the selected items.',
    triggerId: '',
    threadAction: 'improve',
    promptSteps: [
      {
        name: 'Review and plan',
        prompt:
          'Review the completed changes against the product and engineering quality bar. Propose a concise set of independent improvements with evidence, impact, and implementation scope.',
      },
    ],
  },
  {
    id: 'delivery',
    moduleId: 'core',
    moduleName: 'VertexADE',
    name: 'Finish delivery',
    description: 'Continue implementation from an event and prepare the result for review.',
    triggerId: '',
    threadAction: 'work',
    promptSteps: [
      {
        name: 'Deliver',
        prompt:
          'Finish the intended outcome, resolve blocking issues, run the relevant quality checks, and summarize the result and any remaining risks.',
      },
    ],
  },
]

export function parseInput(value: string) {
  if (!value.trim()) return undefined
  return JSON.parse(value) as AutomationStep['input']
}

export function parseConditionValue(value: string): CapabilityValue {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed) as CapabilityValue
  } catch {
    return value
  }
}

export function draftCondition(condition: AutomationCondition): DraftCondition {
  const value = condition.value
  return {
    field: condition.field,
    operator: condition.operator,
    value: typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value),
  }
}

export function firstPrompt(current: RecipeDraft, name: string): DraftPrompt[] {
  return [{ name, prompt: current.promptSteps.at(0)?.prompt ?? '' }]
}

export function implementationPrompts(current: RecipeDraft) {
  if (current.threadAction === 'improve') return firstPrompt(current, 'Understand')
  if (!current.promptSteps.length) return [emptyPrompt()]
  return current.promptSteps
}

export function promptsForThreadAction(current: RecipeDraft, value: AutomationThreadAction): DraftPrompt[] {
  if (value === 'none') return []
  if (value === 'improve') return firstPrompt(current, 'Review and plan')
  return implementationPrompts(current)
}

export function schemaFields(schema: CapabilitySchema | undefined, prefix = 'data', labelPrefix = ''): ConditionField[] {
  if (!schema?.properties) return []
  return Object.entries(schema.properties).flatMap(([name, child]) => {
    const field = `${prefix}.${name}`
    const label = [labelPrefix, child.title || name.replaceAll('_', ' ')].filter(Boolean).join(' · ')
    const descriptor = {
      value: field,
      label,
      description: child.description,
      type: child.type,
      options: child.enum?.filter((value): value is string => typeof value === 'string'),
    }
    return [descriptor, ...schemaFields(child, field, label)]
  })
}

export const baseConditionFields: ConditionField[] = [
  { value: 'id', label: 'Event ID', type: 'string' },
  { value: 'occurredAt', label: 'Occurred at', type: 'string' },
  { value: 'subject', label: 'Event subject', type: 'string' },
]

export const boundActionFields: ConditionField[] = [
  {
    value: 'thread.status',
    label: 'Run · status',
    type: 'string',
    options: ['completed', 'failed', 'resumable'],
  },
  { value: 'thread.exit_code', label: 'Run · exit code', type: 'integer' },
  { value: 'thread.kind', label: 'Run · kind', type: 'string' },
  { value: 'thread.branch_name', label: 'Run · branch', type: 'string' },
  { value: 'thread.diff_additions', label: 'Run · additions', type: 'integer' },
  { value: 'thread.diff_deletions', label: 'Run · deletions', type: 'integer' },
  { value: 'thread.pr_number', label: 'Run · PR number', type: 'integer' },
]

export function conditionFieldType(field?: ConditionField) {
  return field ? field.type : undefined
}

export function fieldHasOptions(field?: ConditionField) {
  return Boolean(field && field.options && field.options.length)
}

export function operatorGroup(field?: ConditionField) {
  const typeGroup = operatorGroupByType[String(conditionFieldType(field))]
  if (typeGroup) return typeGroup
  return fieldHasOptions(field) ? 'options' : 'string'
}

export function operatorsFor(field?: ConditionField) {
  return operators.filter(({ value }) => operatorGroups[operatorGroup(field)].has(value))
}

export function triggerSupportsThread(trigger: CapabilityOption | undefined, action: Exclude<AutomationThreadAction, 'none'>) {
  const supported =
    action !== 'review'
      ? new Set(['work-item', 'agent-thread', 'pull-request', 'repository'])
      : new Set(['work-item', 'agent-thread', 'pull-request'])
  return Boolean(trigger?.outputSchema?.properties?.entityType?.enum?.some((value) => supported.has(String(value))))
}

export function ConditionBuilder({
  conditions,
  mode,
  fields,
  title = '2. Only if',
  description = 'Add precise filters. Every matching event starts the outcome when no filters are set.',
  onConditionsChange,
  onModeChange,
}: {
  conditions: DraftCondition[]
  mode: AutomationConditionMode
  fields: ConditionField[]
  title?: string
  description?: string
  onConditionsChange(value: DraftCondition[]): void
  onModeChange(value: AutomationConditionMode): void
}) {
  const update = (index: number, value: Partial<DraftCondition>) =>
    onConditionsChange(conditions.map((condition, position) => (position === index ? { ...condition, ...value } : condition)))
  return (
    <section className="space-y-3 rounded-lg border border-violet-500/20 bg-violet-500/[.035] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <strong className="flex items-center gap-1.5 text-xs">
            <Filter className="size-3.5 text-violet-400" />
            {title}
          </strong>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Match
          <Select value={mode} onValueChange={(value) => onModeChange(value as AutomationConditionMode)}>
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all</SelectItem>
              <SelectItem value="any">any</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {conditions.map((condition, index) => (
        <ConditionRow
          key={index}
          condition={condition}
          fields={fields}
          onChange={(value) => update(index, value)}
          onRemove={() => onConditionsChange(conditions.filter((_, position) => position !== index))}
        />
      ))}
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => onConditionsChange([...conditions, { ...emptyCondition(), field: fields[0]?.value || 'data.reason' }])}
      >
        <Plus />
        Add filter
      </Button>
    </section>
  )
}

export function ConditionRow({
  condition,
  fields,
  onChange,
  onRemove,
}: {
  condition: DraftCondition
  fields: ConditionField[]
  onChange(value: Partial<DraftCondition>): void
  onRemove(): void
}) {
  const selectedField = fields.find((field) => field.value === condition.field)
  return (
    <div className="min-w-0 space-y-1.5 rounded-md border bg-background/80 p-2">
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2">
        <Select value={condition.field} onValueChange={(value) => onChange({ field: value, operator: 'equals', value: '' })}>
          <SelectTrigger className="w-full min-w-0 text-xs">
            <SelectValue placeholder="Choose event field" />
          </SelectTrigger>
          <SelectContent>
            <CurrentFieldOption field={condition.field} selected={selectedField} />
            {fields.map((field) => (
              <SelectItem key={field.value} value={field.value}>
                {field.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={condition.operator} onValueChange={(value) => onChange({ operator: value as AutomationConditionOperator })}>
          <SelectTrigger className="w-full min-w-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operatorsFor(selectedField).map((operator) => (
              <SelectItem key={operator.value} value={operator.value}>
                {operator.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
        <div className="min-w-0">
          <ConditionValue condition={condition} field={selectedField} onChange={(value) => onChange({ value })} />
        </div>
        <Button type="button" variant="ghost" size="icon-sm" title="Remove condition" aria-label="Remove condition" onClick={onRemove}>
          <X />
        </Button>
      </div>
      <ConditionDescription field={selectedField} />
    </div>
  )
}

export function CurrentFieldOption({ field, selected }: { field: string; selected?: ConditionField }) {
  if (selected || !field) return null
  return <SelectItem value={field}>{field}</SelectItem>
}

export function ConditionDescription({ field }: { field?: ConditionField }) {
  if (!field?.description) return null
  return <p className="px-1 text-xs text-muted-foreground">{field.description}</p>
}

export type ConditionValueKind = 'disabled' | 'list' | 'options' | 'number' | 'text'
export const inputValueKinds: Record<
  Exclude<ConditionValueKind, 'disabled' | 'options'>,
  { type: 'number' | 'text'; placeholder: string; className: string }
> = {
  list: { type: 'text', placeholder: '["one", "two"]', className: 'font-mono text-xs' },
  number: { type: 'number', placeholder: 'Value', className: 'text-xs' },
  text: { type: 'text', placeholder: 'Value', className: 'text-xs' },
}

export function scalarValueKind(field?: ConditionField): 'options' | 'number' | 'text' {
  if (fieldHasOptions(field)) return 'options'
  return scalarKindByType[String(conditionFieldType(field))] ?? 'text'
}

export function conditionValueKind(condition: DraftCondition, field?: ConditionField): ConditionValueKind {
  if (valueOptional.has(condition.operator)) return 'disabled'
  if (['in', 'not_in'].includes(condition.operator)) return 'list'
  return scalarValueKind(field)
}

export function ConditionValue(props: { condition: DraftCondition; field?: ConditionField; onChange(value: string): void }) {
  const kind = conditionValueKind(props.condition, props.field)
  if (kind === 'disabled') return <Input disabled value="No value needed" className="text-xs" />
  if (kind === 'options') return <ConditionOptionValue {...props} />
  return <ConditionInputValue {...props} kind={kind} />
}

export function ConditionOptionValue({
  condition,
  field,
  onChange,
}: {
  condition: DraftCondition
  field?: ConditionField
  onChange(value: string): void
}) {
  return (
    <Select value={condition.value || undefined} onValueChange={onChange}>
      <SelectTrigger className="w-full text-xs">
        <SelectValue placeholder="Choose value" />
      </SelectTrigger>
      <SelectContent>
        {field?.options?.map((option) => (
          <SelectItem key={option} value={option}>
            {option.replaceAll('_', ' ')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ConditionInputValue({
  condition,
  kind,
  onChange,
}: {
  condition: DraftCondition
  kind: 'list' | 'number' | 'text'
  onChange(value: string): void
}) {
  const config = inputValueKinds[kind]
  return (
    <Input
      type={config.type}
      value={condition.value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={config.placeholder}
      className={config.className}
    />
  )
}

export function serializedSteps(draftSteps: DraftStep[]) {
  return draftSteps.map((step) => {
    const input = step.inputSource === 'literal' ? parseInput(step.input) : undefined
    return {
      kind: step.kind,
      capabilityId: step.capabilityId,
      inputSource: step.inputSource,
      ...(input === undefined ? {} : { input }),
      conditionMode: step.conditionMode,
      conditions: serializedConditionList(step.conditions),
    }
  })
}

export function serializedConditions(triggerId: string, conditions: DraftCondition[]) {
  if (triggerId === 'manual') return []
  return serializedConditionList(conditions)
}

export function serializedConditionList(conditions: DraftCondition[]) {
  return conditions.map((condition) => ({
    field: condition.field,
    operator: condition.operator,
    ...(valueOptional.has(condition.operator) ? {} : { value: parseConditionValue(condition.value) }),
  }))
}

export function serializedBoundActions(actions: DraftBoundAction[]) {
  return actions.map((action) => {
    const input = parseInput(action.input)
    return {
      capabilityId: action.capabilityId,
      conditionMode: action.conditionMode,
      conditions: serializedConditionList(action.conditions),
      ...(input === undefined ? {} : { input }),
    }
  })
}

export function saveRequest(editingId: number | null) {
  if (editingId === null)
    return {
      path: '/api/automation-recipes',
      method: 'POST',
      message: 'Automation recipe created',
    } as const
  return {
    path: `/api/automation-recipes/${editingId}`,
    method: 'PATCH',
    message: 'Automation recipe updated',
  } as const
}

export function saveError(error: unknown) {
  return error instanceof SyntaxError ? 'Step input must be valid JSON' : (error as Error).message
}

export function eventIsAutomation(event: Event) {
  return ['automation_', 'capability_', 'extensions_'].some((prefix) => eventReason(event).startsWith(prefix))
}

export function updatedSteps(steps: DraftStep[], index: number, value: Partial<DraftStep>) {
  return steps.map((step, position) => (position === index ? { ...step, ...value } : step))
}

export function canKeepThread(current: RecipeDraft, trigger?: CapabilityOption) {
  if (current.threadAction === 'none') return true
  return triggerSupportsThread(trigger, current.threadAction)
}

export function resetThreadOutcome(current: RecipeDraft, triggerId: string): RecipeDraft {
  return { ...current, triggerId, threadAction: 'none', promptSteps: [], boundActions: [] }
}

export function draftWithTrigger(current: RecipeDraft, triggerId: string, trigger?: CapabilityOption): RecipeDraft {
  if (triggerId === 'manual') return resetThreadOutcome(current, triggerId)
  if (canKeepThread(current, trigger)) return { ...current, triggerId }
  return resetThreadOutcome(current, triggerId)
}

export function draftStep(step: AutomationStep): DraftStep {
  return {
    kind: step.kind,
    capabilityId: step.capabilityId,
    inputSource: step.inputSource || (step.input === undefined ? 'trigger' : 'literal'),
    input: step.input === undefined ? '' : JSON.stringify(step.input, null, 2),
    conditionMode: step.conditionMode || 'all',
    conditions: (step.conditions || []).map(draftCondition),
  }
}

export function draftBoundAction(action: AutomationRecipe['boundActions'][number]): DraftBoundAction {
  return {
    capabilityId: action.capabilityId,
    input: action.input === undefined ? '' : JSON.stringify(action.input, null, 2),
    conditionMode: action.conditionMode,
    conditions: action.conditions.map(draftCondition),
  }
}

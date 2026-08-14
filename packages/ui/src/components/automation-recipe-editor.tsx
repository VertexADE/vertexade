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
import { Braces, Bot, Filter, GitPullRequest, Pencil, Play, Plus, Power, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
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
import type { Repository } from '@vertexade/ui/lib/dashboard-types'

import {
  ConditionBuilder,
  boundActionFields,
  draftPullRequestAction,
  emptyBoundAction,
  emptyStep,
  schemaFields,
  triggerSupportsThread,
  valueOptional,
  type CapabilityOption,
  type ConditionField,
  type DraftBoundAction,
  type DraftCondition,
  type DraftPrompt,
  type DraftStep,
  type RecipeTemplate,
} from './automation-recipe-condition-editor'
export * from './automation-recipe-condition-editor'
import { AdvancedRecipeOptions } from './automation-recipe-advanced-options'
import { RecipeSteps } from './automation-recipe-steps'
import { AutomationScheduleEditor, scheduleCadence } from './automation-schedule-editor'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { AgentResourcePicker, emptyAgentResourceSelection } from '@vertexade/ui/components/agent-resource-picker'
import type { AgentLaunchOptions } from '@vertexade/ui/lib/dashboard-api'
import { fullAutomationFlow } from './automation-flow-presets'

export function RecipeEditor(props: {
  editingId: number | null
  name: string
  description: string
  triggerId: string
  trigger?: CapabilityOption
  triggers: CapabilityOption[]
  conditionMode: AutomationConditionMode
  conditions: DraftCondition[]
  conditionFields: ConditionField[]
  threadAction: AutomationThreadAction
  agentOptions: AgentLaunchOptions
  resourceSelection: { skills: string[]; mcpServers: string[] } | null
  promptSteps: DraftPrompt[]
  boundActions: DraftBoundAction[]
  schedule: AutomationSchedule | null
  steps: DraftStep[]
  repositories: Array<Pick<Repository, 'id' | 'full_name'>>
  choices: Record<string, CapabilityOption[]>
  templates: RecipeTemplate[]
  busy: string
  onNameChange(value: string): void
  onDescriptionChange(value: string): void
  onTriggerChange(value: string): void
  onConditionModeChange(value: AutomationConditionMode): void
  onConditionsChange(value: DraftCondition[]): void
  onThreadActionChange(value: AutomationThreadAction): void
  onAgentOptionsChange(value: AgentLaunchOptions): void
  onResourceSelectionChange(value: { skills: string[]; mcpServers: string[] }): void
  onPromptStepsChange(value: DraftPrompt[]): void
  onBoundActionsChange(value: DraftBoundAction[]): void
  onScheduleChange(value: AutomationSchedule): void
  onStepChange(index: number, value: Partial<DraftStep>): void
  onStepsChange(value: DraftStep[]): void
  onApplyTemplate(template: RecipeTemplate): void
  onReset(): void
  onSave(event: React.FormEvent): void
}) {
  const outcomeStep = props.triggerId === 'manual' ? 2 : 3
  const actionsStep = outcomeStep + 1
  return (
    <form id="automation-recipe-form" onSubmit={props.onSave} className="mx-auto min-w-0 max-w-5xl space-y-2.5 py-3 sm:py-4">
      <EditingBanner editingId={props.editingId} onReset={props.onReset} />
      {!props.editingId && (
        <RecipeTemplates trigger={props.trigger} triggers={props.triggers} templates={props.templates} onApply={props.onApplyTemplate} />
      )}
      <RecipeIdentity
        name={props.name}
        description={props.description}
        onNameChange={props.onNameChange}
        onDescriptionChange={props.onDescriptionChange}
      />
      <RecipeTrigger triggerId={props.triggerId} trigger={props.trigger} triggers={props.triggers} onChange={props.onTriggerChange} />
      {props.triggerId === 'core.scheduled' && props.schedule && (
        <AutomationScheduleEditor value={props.schedule} repositories={props.repositories} onChange={props.onScheduleChange} />
      )}
      <EventFilters
        triggerId={props.triggerId}
        conditions={props.conditions}
        mode={props.conditionMode}
        fields={props.conditionFields}
        onConditionsChange={props.onConditionsChange}
        onModeChange={props.onConditionModeChange}
      />
      <ThreadOutcome
        stepNumber={outcomeStep}
        action={props.threadAction}
        prompts={props.promptSteps}
        triggerId={props.triggerId}
        trigger={props.trigger}
        onActionChange={props.onThreadActionChange}
        onPromptsChange={props.onPromptStepsChange}
      />
      {props.threadAction !== 'none' && (
        <section className="rounded-lg border bg-muted/[.08] p-3 sm:p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold">Thread runtime</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose the provider, model, and reasoning level for this automation's thread.
            </p>
          </div>
          <AgentOptionsPicker value={props.agentOptions} onChange={props.onAgentOptionsChange} />
          <AgentResourcePicker value={props.resourceSelection || emptyAgentResourceSelection} onChange={props.onResourceSelectionChange} />
        </section>
      )}
      <AdvancedRecipeOptions actionCount={props.boundActions.length} checkCount={props.steps.length}>
        <BoundActions
          stepNumber={actionsStep}
          actions={props.boundActions}
          choices={props.choices.action || []}
          trigger={props.trigger}
          onChange={props.onBoundActionsChange}
        />
        <RecipeSteps
          steps={props.steps}
          choices={props.choices}
          canRemoveLast={props.threadAction !== 'none'}
          onChange={props.onStepChange}
          onStepsChange={props.onStepsChange}
        />
      </AdvancedRecipeOptions>
      <RecipeFlowPreview
        triggerId={props.triggerId}
        trigger={props.trigger}
        action={props.threadAction}
        prompts={props.promptSteps}
        boundActions={props.boundActions}
        schedule={props.triggerId === 'core.scheduled' ? props.schedule : null}
      />
      <RecipeSubmitButton
        busy={props.busy}
        editingId={props.editingId}
        name={props.name}
        triggerId={props.triggerId}
        trigger={props.trigger}
        conditions={props.conditions}
        steps={props.steps}
        threadAction={props.threadAction}
        prompts={props.promptSteps}
        boundActions={props.boundActions}
        schedule={props.triggerId === 'core.scheduled' ? props.schedule : null}
      />
    </form>
  )
}

function RecipeIdentity({
  name,
  description,
  onNameChange,
  onDescriptionChange,
}: {
  name: string
  description: string
  onNameChange(value: string): void
  onDescriptionChange(value: string): void
}) {
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Label className="min-w-0 flex-col items-stretch gap-1">
        <span className="text-xs uppercase text-muted-foreground">Automation name</span>
        <Input
          required
          maxLength={120}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Review completed implementation"
        />
      </Label>
      <Label className="min-w-0 flex-col items-stretch gap-1">
        <span className="text-xs uppercase text-muted-foreground">Purpose</span>
        <Input
          value={description}
          maxLength={1_000}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="Keep delivery quality high"
        />
      </Label>
    </div>
  )
}

function RecipeTrigger({
  triggerId,
  trigger,
  triggers,
  onChange,
}: {
  triggerId: string
  trigger?: CapabilityOption
  triggers: CapabilityOption[]
  onChange(value: string): void
}) {
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <strong className="text-xs">1. When this happens</strong>
      <Select value={triggerId} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manual">Run manually</SelectItem>
          {triggers.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name} · {item.moduleId}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <TriggerDescription trigger={trigger} />
    </section>
  )
}

export function RecipeTemplates({
  trigger,
  triggers,
  templates,
  onApply,
}: {
  trigger?: CapabilityOption
  triggers: CapabilityOption[]
  templates: RecipeTemplate[]
  onApply(template: RecipeTemplate): void
}) {
  return (
    <section className="space-y-2 rounded-lg border border-violet-500/20 bg-violet-500/[.035] p-2.5">
      <div>
        <strong className="flex items-center gap-1.5 text-sm">
          <Sparkles className="size-4 text-violet-400" />
          Start from a proven flow
        </strong>
        <p className="hidden text-xs text-muted-foreground sm:block">
          Assigned-PR templates choose the event and add a username filter for you. Every field remains editable.
        </p>
      </div>
      <div className="flex snap-x gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:grid-cols-5">
        {templates.map((template) => {
          const templateTrigger = template.triggerId ? triggers.find((item) => item.id === template.triggerId) : trigger
          const available = triggerSupportsThread(templateTrigger, template.threadAction)
          return (
            <button
              key={`${template.moduleId}:${template.id}`}
              type="button"
              disabled={!available}
              onClick={() => onApply(template)}
              className="w-52 shrink-0 snap-start rounded-md border bg-background/70 p-2.5 text-left transition hover:border-violet-500/40 hover:bg-violet-500/[.04] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
            >
              <span className="mb-1 block font-mono text-xs uppercase tracking-wide text-muted-foreground">{template.moduleName}</span>
              <strong className="block text-xs">{template.name}</strong>
              <span className="mt-1 hidden text-xs leading-relaxed text-muted-foreground sm:block">{template.description}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function RecipeFlowPreview({
  triggerId,
  trigger,
  action,
  prompts,
  boundActions,
  schedule,
}: {
  triggerId: string
  trigger?: CapabilityOption
  action: AutomationThreadAction
  prompts: DraftPrompt[]
  boundActions: DraftBoundAction[]
  schedule: AutomationSchedule | null
}) {
  const outcome = recipeOutcome(action, prompts.length)
  const summary = recipeTriggerSummary(triggerId, trigger, schedule, outcome)
  return (
    <div className="rounded-lg border bg-background/70 p-3 text-xs leading-relaxed">
      <span className="font-medium">Flow preview: </span>
      <span className="text-muted-foreground">
        {summary}
        {boundActions.length ? `, then perform ${boundActions.length} guarded action${boundActions.length === 1 ? '' : 's'}` : ''}.
      </span>
    </div>
  )
}

function recipeOutcome(action: AutomationThreadAction, promptCount: number) {
  if (action === 'none') return 'run configured platform checks and actions'
  if (action === 'improve') return 'review, pause for approval, and improve in one run'
  return `start one ${action} run with ${promptCount} prompt phase${promptCount === 1 ? '' : 's'}`
}

function recipeTriggerSummary(
  triggerId: string,
  trigger: CapabilityOption | undefined,
  schedule: AutomationSchedule | null,
  outcome: string,
) {
  if (!schedule) {
    const event = triggerId === 'manual' ? 'a manual start' : trigger?.name || 'the selected event'
    return `When ${event} occurs, ${outcome}`
  }
  const repositoryLabel = schedule.repositoryIds.length === 1 ? 'repository' : 'repositories'
  const execution = schedule.executionMode === 'unified' ? 'in one unified Work item' : 'as independent runs'
  return `On ${scheduleCadence(schedule)} (${schedule.timezone}), ${outcome} ${execution} for ${schedule.repositoryIds.length} selected ${repositoryLabel}`
}

export function ThreadOutcome({
  stepNumber,
  action,
  prompts,
  triggerId,
  trigger,
  onActionChange,
  onPromptsChange,
}: {
  stepNumber: number
  action: AutomationThreadAction
  prompts: DraftPrompt[]
  triggerId: string
  trigger?: CapabilityOption
  onActionChange(value: AutomationThreadAction): void
  onPromptsChange(value: DraftPrompt[]): void
}) {
  const improve = action === 'improve'
  return (
    <section className="space-y-2 rounded-lg border border-cyan-500/20 bg-cyan-500/[.035] p-3">
      <div>
        <strong className="text-xs">
          {stepNumber}. {improve ? 'Review, approve, then improve' : 'Run one agent flow'}
        </strong>
        <p className="text-xs text-muted-foreground">
          {improve
            ? 'The agent reviews without editing, proposes selectable improvements, and pauses until you approve exactly what it may fix.'
            : 'Every prompt runs sequentially in the same run and keeps the context produced by earlier phases.'}
        </p>
      </div>
      <Select value={action} onValueChange={(value) => onActionChange(value as AutomationThreadAction)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No agent run</SelectItem>
          <SelectItem value="work" disabled={!triggerSupportsThread(trigger, 'work')}>
            <span className="flex items-center gap-2">
              <Bot className="size-3.5" />
              One Work flow
            </span>
          </SelectItem>
          <SelectItem value="review" disabled={!triggerSupportsThread(trigger, 'review')}>
            <span className="flex items-center gap-2">
              <GitPullRequest className="size-3.5" />
              One Review flow
            </span>
          </SelectItem>
          <SelectItem value="improve" disabled={!triggerSupportsThread(trigger, 'improve')}>
            <span className="flex items-center gap-2">
              <Sparkles className="size-3.5" />
              Improve · review, approve, fix
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      <PromptPhases action={action} prompts={prompts} onChange={onPromptsChange} />
      <ThreadTargetWarning action={action} triggerId={triggerId} trigger={trigger} />
    </section>
  )
}

export function PromptPhases({
  action,
  prompts,
  onChange,
}: {
  action: AutomationThreadAction
  prompts: DraftPrompt[]
  onChange(value: DraftPrompt[]): void
}) {
  if (action === 'none') return null
  if (action === 'improve') {
    const phase = prompts[0] || { name: 'Review and plan', prompt: '' }
    return (
      <Label className="flex-col items-stretch gap-1.5 rounded-md border bg-background/80 p-2">
        <span className="text-xs font-medium">Review brief</span>
        <Textarea
          required
          value={phase.prompt}
          maxLength={20_000}
          onChange={(event) => onChange([{ name: 'Review and plan', prompt: event.target.value }])}
          placeholder="Describe what should be reviewed, the desired quality bar, constraints, and what a good improvement plan must cover…"
          className="min-h-28"
        />
        <span className="block text-xs leading-relaxed text-muted-foreground">
          Planning is read-only. Implementation starts only after you approve one or more proposed items.
        </span>
      </Label>
    )
  }
  const update = (index: number, value: Partial<DraftPrompt>) =>
    onChange(prompts.map((phase, position) => (position === index ? { ...phase, ...value } : phase)))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2">
        <span className="text-xs text-muted-foreground">Need an end-to-end starting point?</span>
        <Button type="button" size="xs" variant="outline" onClick={() => onChange(fullAutomationFlow(action))}>
          <Sparkles />
          {action === 'review' ? 'Build review flow' : 'Build full delivery flow'}
        </Button>
      </div>
      {prompts.map((phase, index) => (
        <div key={index} className="space-y-2 rounded-md border bg-background/80 p-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              required
              value={phase.name}
              maxLength={80}
              onChange={(event) => update(index, { name: event.target.value })}
              placeholder={`Phase ${index + 1} name`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={prompts.length === 1}
              aria-label={`Remove prompt phase ${index + 1}`}
              onClick={() => onChange(prompts.filter((_, position) => position !== index))}
            >
              <X />
            </Button>
          </div>
          <Textarea
            required
            value={phase.prompt}
            maxLength={20_000}
            onChange={(event) => update(index, { prompt: event.target.value })}
            placeholder={
              action === 'review' ? 'Describe what this review phase should establish…' : 'Describe the outcome this phase should complete…'
            }
            className="min-h-24"
          />
          <p className="font-mono text-xs text-muted-foreground">
            Phase {index + 1} of {prompts.length} · same run
          </p>
        </div>
      ))}
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => onChange([...prompts, { name: `Phase ${prompts.length + 1}`, prompt: '' }])}
      >
        <Plus />
        Prompt phase
      </Button>
    </div>
  )
}

export function BoundActions({
  stepNumber,
  actions,
  choices,
  trigger,
  onChange,
}: {
  stepNumber: number
  actions: DraftBoundAction[]
  choices: CapabilityOption[]
  trigger?: CapabilityOption
  onChange(value: DraftBoundAction[]): void
}) {
  const available = choices.filter((choice) => !choice.id.endsWith('.remediate'))
  const fields = [...boundActionFields, ...schemaFields(trigger?.outputSchema, 'trigger.data', 'Trigger')]
  return (
    <section className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/[.035] p-3">
      <BoundActionHeader stepNumber={stepNumber} actions={actions} choices={available} onChange={onChange} />
      {!actions.length && (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          No external action. The agent flow ends without publishing or deploying anything.
        </p>
      )}
      {actions.map((action, index) => (
        <BoundActionCard
          key={index}
          action={action}
          index={index}
          actions={actions}
          choices={available}
          fields={fields}
          onChange={onChange}
        />
      ))}
    </section>
  )
}

export function BoundActionHeader({
  stepNumber,
  actions,
  choices,
  onChange,
}: {
  stepNumber: number
  actions: DraftBoundAction[]
  choices: CapabilityOption[]
  onChange(value: DraftBoundAction[]): void
}) {
  const draftAvailable = choices.some((choice) => choice.id === 'core.create-draft-pr')
  const draftSelected = actions.some((action) => action.capabilityId === 'core.create-draft-pr')
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <strong className="text-xs">{stepNumber}. Publishing actions</strong>
        <p className="text-xs text-muted-foreground">
          Optional platform actions after every prompt succeeds. Runtime safety checks still apply.
        </p>
      </div>
      <div className="flex gap-1">
        {draftAvailable && !draftSelected && (
          <Button type="button" size="xs" variant="outline" onClick={() => onChange([...actions, draftPullRequestAction()])}>
            <GitPullRequest />
            Draft PR
          </Button>
        )}
        <Button type="button" size="xs" variant="outline" onClick={() => onChange([...actions, emptyBoundAction()])}>
          <Plus />
          Action
        </Button>
      </div>
    </div>
  )
}

export function BoundActionCard({
  action,
  index,
  actions,
  choices,
  fields,
  onChange,
}: {
  action: DraftBoundAction
  index: number
  actions: DraftBoundAction[]
  choices: CapabilityOption[]
  fields: ConditionField[]
  onChange(value: DraftBoundAction[]): void
}) {
  const update = (value: Partial<DraftBoundAction>) =>
    onChange(actions.map((item, position) => (position === index ? { ...item, ...value } : item)))
  return (
    <div className="space-y-2 rounded-md border bg-background/80 p-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Select value={action.capabilityId || undefined} onValueChange={(value) => update({ capabilityId: value })}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a platform action" />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice.id} value={choice.id}>
                {choice.name} · {choice.moduleId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove bound action ${index + 1}`}
          onClick={() => onChange(actions.filter((_, position) => position !== index))}
        >
          <X />
        </Button>
      </div>
      <Label className="relative block">
        <Braces className="absolute left-2 top-2 size-3.5 text-muted-foreground" />
        <Textarea
          value={action.input}
          onChange={(event) => update({ input: event.target.value })}
          placeholder="Optional action configuration as JSON"
          className="min-h-14 pl-7 font-mono text-xs"
        />
      </Label>
      <ConditionBuilder
        title="Run action only if"
        description="These conditions are evaluated against the completed run and original trigger."
        conditions={action.conditions}
        mode={action.conditionMode}
        fields={fields}
        onConditionsChange={(conditions) => update({ conditions })}
        onModeChange={(conditionMode) => update({ conditionMode })}
      />
    </div>
  )
}

export function ThreadTargetWarning({
  action,
  triggerId,
  trigger,
}: {
  action: AutomationThreadAction
  triggerId: string
  trigger?: CapabilityOption
}) {
  if (action === 'none') return null
  if (triggerId === 'manual')
    return (
      <p className="text-xs text-amber-400">
        Choose an event trigger so the automation knows which Work item, run, or pull request to use.
      </p>
    )
  if (!triggerSupportsThread(trigger, action))
    return (
      <p className="text-xs text-amber-400">
        This trigger does not provide a compatible target. Choose a Work item, agent run, pull request, or repository event.
      </p>
    )
  return null
}

export function EditingBanner({ editingId, onReset }: { editingId: number | null; onReset(): void }) {
  if (!editingId) return null
  return (
    <div className="flex items-center justify-between rounded-md border border-violet-500/25 bg-violet-500/[.06] px-3 py-2 text-xs">
      <span>Editing recipe #{editingId}</span>
      <Button type="button" size="xs" variant="ghost" onClick={onReset}>
        <RotateCcw />
        Cancel
      </Button>
    </div>
  )
}

export function TriggerDescription({ trigger }: { trigger?: CapabilityOption }) {
  if (!trigger?.description) return null
  return <p className="text-xs leading-relaxed text-muted-foreground">{trigger.description}</p>
}

export function EventFilters(props: {
  triggerId: string
  conditions: DraftCondition[]
  mode: AutomationConditionMode
  fields: ConditionField[]
  onConditionsChange(value: DraftCondition[]): void
  onModeChange(value: AutomationConditionMode): void
}) {
  if (props.triggerId === 'manual' || props.triggerId === 'core.scheduled') return null
  return (
    <ConditionBuilder
      conditions={props.conditions}
      mode={props.mode}
      fields={props.fields}
      onConditionsChange={props.onConditionsChange}
      onModeChange={props.onModeChange}
    />
  )
}

export function RecipeSubmitButton({
  busy,
  editingId,
  name,
  triggerId,
  trigger,
  conditions,
  steps,
  threadAction,
  prompts,
  boundActions,
  schedule,
}: {
  busy: string
  editingId: number | null
  name: string
  triggerId: string
  trigger?: CapabilityOption
  conditions: DraftCondition[]
  steps: DraftStep[]
  threadAction: AutomationThreadAction
  prompts: DraftPrompt[]
  boundActions: DraftBoundAction[]
  schedule: AutomationSchedule | null
}) {
  const issue = recipeDraftIssue(busy, name, triggerId, trigger, conditions, steps, threadAction, prompts, boundActions, schedule)
  return (
    <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center">
      <Button disabled={Boolean(issue)}>{recipeSubmitLabel(busy, editingId)}</Button>
      {issue && busy !== 'save' && <p className="text-xs text-muted-foreground">{issue}</p>}
    </div>
  )
}

export function recipeDraftIssue(
  busy: string,
  name: string,
  triggerId: string,
  trigger: CapabilityOption | undefined,
  conditions: DraftCondition[],
  steps: DraftStep[],
  action: AutomationThreadAction,
  prompts: DraftPrompt[],
  boundActions: DraftBoundAction[],
  schedule: AutomationSchedule | null = null,
) {
  if (busy === 'save') return 'Saving recipe…'
  if (!name.trim()) return 'Add a clear automation name.'
  if (conditions.some((condition) => !valueOptional.has(condition.operator) && !condition.value.trim()))
    return 'Complete every event filter value.'
  const scheduleIssue = recipeScheduleIssue(triggerId, schedule)
  if (scheduleIssue) return scheduleIssue
  if (incompleteCapabilities(steps, boundActions)) return 'Choose a capability for every preflight step and bound action.'
  if (action !== 'none' && triggerId === 'manual') return 'Choose an event trigger before starting an agent run.'
  if (action !== 'none' && !triggerSupportsThread(trigger, action))
    return 'Choose an event that provides a compatible Work item, run, pull request, or repository.'
  if (action === 'none' && nothingConfigured(steps, boundActions)) return 'Add an agent flow, preflight step, or bound action.'
  if (action !== 'none' && incompletePrompts(prompts)) return 'Complete the name and instruction for every prompt phase.'
  return ''
}

function recipeScheduleIssue(triggerId: string, schedule: AutomationSchedule | null) {
  if (triggerId !== 'core.scheduled' || schedule?.repositoryIds.length) return ''
  return 'Choose at least one repository for this automation.'
}

export function nothingConfigured(steps: DraftStep[], actions: DraftBoundAction[]) {
  return steps.length === 0 && actions.length === 0
}

export function incompleteCapabilities(steps: DraftStep[], actions: DraftBoundAction[]) {
  return steps.some((step) => !step.capabilityId) || actions.some((item) => !item.capabilityId)
}

export function incompletePrompts(prompts: DraftPrompt[]) {
  return !prompts.length || prompts.some((phase) => !phase.name.trim() || !phase.prompt.trim())
}

export function recipeSubmitLabel(busy: string, editingId: number | null) {
  if (busy === 'save') return 'Saving…'
  if (editingId) return 'Save changes'
  return 'Create recipe'
}

export function conditionText(condition: AutomationCondition) {
  const field = condition.field.split('.').at(-1)?.replaceAll('_', ' ') || condition.field
  if (condition.value === undefined) return `${field} ${condition.operator.replaceAll('_', ' ')}`
  const value = typeof condition.value === 'string' ? condition.value : JSON.stringify(condition.value)
  return `${field} ${condition.operator.replaceAll('_', ' ')} ${value}`
}

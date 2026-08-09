import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AutomationAuditEvent, AutomationFlowRun, AutomationRecipe, CapabilityExecution } from '@vertexade/platform-contracts'
import { Power, Workflow } from 'lucide-react'
import { AutomationImprovementApproval } from '@vertexade/ui/components/automation-improvement-approval'
import { RecipeList, recipeStatusTone } from '@vertexade/ui/components/automation-recipe-list'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import {
  RecipeEditor,
  type AutomationRuntimeStatus,
  type CapabilityOption,
  type RecipeDraft,
  type RecipeTemplate,
} from '@vertexade/ui/components/automation-recipe-editor'
import {
  automationCapabilityChoices,
  automationConditionFields,
  automationNames,
  enabledAutomationTriggers,
  visibleAutomationRuns,
} from './automation-recipes-model'
import { useAutomationActions } from '@vertexade/ui/hooks/use-automation-actions'
import { useAutomationDraft } from '@vertexade/ui/hooks/use-automation-draft'
import { useAutomationOverview } from '@vertexade/ui/hooks/use-automation-overview'
function FlowRunList({
  runs,
  recipeNames,
  busy,
  onResolve,
}: {
  runs: AutomationFlowRun[]
  recipeNames: Record<number, string>
  busy: string
  onResolve(run: AutomationFlowRun, selectedIds: string[]): void
}) {
  return (
    <section className="border-b">
      <header className="flex items-center justify-between px-4 py-3">
        <div>
          <strong className="text-xs">Flow runs</strong>
          <p className="text-xs text-muted-foreground">One trigger, one agent run, ordered prompt phases.</p>
        </div>
        <Badge variant="secondary">{runs.length}</Badge>
      </header>
      <div className="max-h-[32rem] overflow-y-auto">
        {runs.map((run) => (
          <FlowRunCard
            key={run.id}
            run={run}
            recipeName={recipeNames[run.recipeId]}
            busy={busy === `approval:${run.id}`}
            onResolve={(selectedIds) => onResolve(run, selectedIds)}
          />
        ))}
        {!runs.length && (
          <p className="border-t p-8 text-center text-xs text-muted-foreground">Completed and active flows will appear here.</p>
        )}
      </div>
    </section>
  )
}

function FlowRunCard({
  run,
  recipeName,
  busy,
  onResolve,
}: {
  run: AutomationFlowRun
  recipeName?: string
  busy: boolean
  onResolve(selectedIds: string[]): void
}) {
  const awaitingApproval = run.improvementApprovalStatus === 'pending'
  return (
    <article className="border-t p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <div className="min-w-0">
          <strong className="block truncate text-xs">{flowRunName(run, recipeName)}</strong>
          <span className="text-xs text-muted-foreground">
            Flow #{run.id} · phase {run.currentPhase}/{run.phaseCount}
            {flowThreadReference(run)}
          </span>
          <FlowRunError error={run.lastError} />
        </div>
        <div className="text-right">
          <Badge variant="outline" className={cn('capitalize', recipeStatusTone(awaitingApproval ? 'approval' : run.status))}>
            {awaitingApproval ? 'Awaiting approval' : run.status}
          </Badge>
          <span className="mt-1 block text-xs text-muted-foreground">{age(run.createdAt)}</span>
        </div>
      </div>
      {awaitingApproval && <AutomationImprovementApproval run={run} busy={busy} onResolve={onResolve} />}
    </article>
  )
}

function flowRunName(run: AutomationFlowRun, recipeName?: string) {
  return recipeName ?? `Automation #${run.recipeId}`
}

function flowThreadReference(run: AutomationFlowRun) {
  return run.threadJobId ? ` · run #${run.threadJobId}` : ''
}

function FlowRunError({ error }: { error: string | null }) {
  if (!error) return null
  return <p className="mt-1 truncate text-xs text-red-400">{error}</p>
}

function ExecutionList({ executions }: { executions: CapabilityExecution[] }) {
  return (
    <section>
      <header className="flex items-center justify-between px-4 py-3">
        <strong className="text-xs">Recent capability executions</strong>
        <Badge variant="secondary">{executions.length}</Badge>
      </header>
      <div className="max-h-64 overflow-y-auto">
        {executions.map((execution) => (
          <article key={execution.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t p-3">
            <div className="min-w-0">
              <strong className="block truncate font-mono text-xs">{execution.capabilityId}</strong>
              <span className="text-xs text-muted-foreground">
                {execution.moduleId} · {execution.capabilityKind} · {execution.attempts}/{execution.maxAttempts} attempts
              </span>
              {execution.error && <p className="mt-1 truncate text-xs text-red-400">{execution.error}</p>}
            </div>
            <div className="text-right">
              <Badge variant="outline" className="capitalize">
                {execution.status}
              </Badge>
              <span className="mt-1 block text-xs text-muted-foreground">{age(execution.createdAt)}</span>
            </div>
          </article>
        ))}
        {!executions.length && (
          <p className="border-t p-8 text-center text-xs text-muted-foreground">Capability executions will appear here.</p>
        )}
      </div>
    </section>
  )
}

function AutomationAuditList({ events }: { events: AutomationAuditEvent[] }) {
  return (
    <section className="border-t">
      <header className="flex items-center justify-between px-4 py-3">
        <div>
          <strong className="text-xs">Automation audit</strong>
          <p className="text-[11px] text-muted-foreground">Immutable flow, approval, and external-action events.</p>
        </div>
        <Badge variant="secondary">{events.length}</Badge>
      </header>
      <div className="max-h-72 overflow-y-auto">
        {events.map((event) => (
          <article key={event.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t p-3">
            <div className="min-w-0">
              <strong className="block truncate font-mono text-[11px]">{event.eventType.replaceAll('_', ' ')}</strong>
              <span className="text-[11px] text-muted-foreground">
                Flow #{event.automationRunId}
                {event.capabilityId ? ` · ${event.capabilityId}` : ''}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">{age(event.createdAt)}</span>
          </article>
        ))}
        {!events.length && <p className="border-t p-8 text-center text-xs text-muted-foreground">Automation activity will appear here.</p>}
      </div>
    </section>
  )
}

export type AutomationView = 'builder' | 'recipes' | 'runs' | 'executions'

export function ExtensionAutomations({
  initialView = 'builder',
  view: controlledView,
  onViewChange,
  repositories = [],
  lockedView = false,
  embedded = false,
  runFilter,
}: {
  initialView?: AutomationView
  view?: AutomationView
  onViewChange?(view: AutomationView): void
  repositories?: Array<Pick<Repository, 'id' | 'full_name'>>
  lockedView?: boolean
  embedded?: boolean
  runFilter?: 'approval' | 'history'
}) {
  const [view, setView] = useState<AutomationView>(initialView)
  const activeView = controlledView ?? view
  useEffect(() => {
    setView(initialView)
  }, [initialView])

  function selectView(nextView: AutomationView) {
    setView(nextView)
    onViewChange?.(nextView)
  }
  const overview = useAutomationOverview()
  const triggers = useMemo(() => enabledAutomationTriggers(overview.capabilities), [overview.capabilities])
  const draftState = useAutomationDraft(triggers, () => selectView('builder'))
  const actions = useAutomationActions({
    draft: draftState.draft,
    resetDraft: draftState.resetDraft,
    load: overview.load,
    runtime: overview.runtime,
    setRuntime: overview.setRuntime,
  })

  return (
    <AutomationWorkspace
      activeView={activeView}
      actions={actions}
      draftState={draftState}
      embedded={embedded}
      lockedView={lockedView}
      onViewChange={selectView}
      overview={overview}
      repositories={repositories}
      runFilter={runFilter}
      triggers={triggers}
    />
  )
}

function AutomationWorkspace({
  activeView,
  actions,
  draftState,
  embedded,
  lockedView,
  onViewChange,
  overview,
  repositories,
  runFilter,
  triggers,
}: {
  activeView: AutomationView
  actions: ReturnType<typeof useAutomationActions>
  draftState: ReturnType<typeof useAutomationDraft>
  embedded: boolean
  lockedView: boolean
  onViewChange(view: AutomationView): void
  overview: ReturnType<typeof useAutomationOverview>
  repositories: Array<Pick<Repository, 'id' | 'full_name'>>
  runFilter: 'approval' | 'history' | undefined
  triggers: CapabilityOption[]
}) {
  const { templates, recipes, runs, executions, auditEvents, runtime, capabilities } = overview
  const { draft } = draftState
  const { busy, toggleRuntime } = actions
  const trigger = triggers.find((capability) => capability.id === draft.triggerId)
  const conditionFields = useMemo(() => automationConditionFields(trigger), [trigger])
  const triggerNames = useMemo(() => Object.fromEntries(triggers.map((item) => [item.id, item.name])), [triggers])
  const recipeNames = useMemo(() => automationNames(recipes), [recipes])
  const visibleRuns = useMemo(() => visibleAutomationRuns(runs, runFilter), [runFilter, runs])
  const choices = useMemo(() => automationCapabilityChoices(capabilities), [capabilities])

  return (
    <Card className={cn('gap-0 overflow-hidden py-0', embedded && 'border-0 bg-transparent')}>
      <AutomationHeader
        activeView={activeView}
        editing={Boolean(draft.editingId)}
        embedded={embedded}
        executionCount={executions.length}
        lockedView={lockedView}
        onViewChange={onViewChange}
        recipeCount={recipes.length}
        runCount={runs.length}
      />
      <AutomationRuntimeBanner embedded={embedded} runtime={runtime} busy={busy} onToggle={() => void toggleRuntime()} />
      <AutomationViewContent
        activeView={activeView}
        actions={actions}
        auditEvents={auditEvents}
        choices={choices}
        conditionFields={conditionFields}
        draftState={draftState}
        embedded={embedded}
        executions={executions}
        recipeNames={recipeNames}
        recipes={recipes}
        repositories={repositories}
        templates={templates}
        trigger={trigger}
        triggerNames={triggerNames}
        triggers={triggers}
        visibleRuns={visibleRuns}
      />
    </Card>
  )
}

function AutomationHeader({
  activeView,
  editing,
  embedded,
  executionCount,
  lockedView,
  onViewChange,
  recipeCount,
  runCount,
}: {
  activeView: AutomationView
  editing: boolean
  embedded: boolean
  executionCount: number
  lockedView: boolean
  onViewChange(view: AutomationView): void
  recipeCount: number
  runCount: number
}) {
  if (embedded && lockedView) return null
  return (
    <CardHeader className={cn('gap-2 border-b p-3', embedded && 'rounded-md border bg-card p-2')}>
      {!embedded && (
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Workflow className="size-4 text-violet-400" />
            Automation
          </CardTitle>
          <CardDescription className="hidden text-xs sm:block">
            Build one understandable flow: trigger, conditions, prompt sequence, agent context, guarded actions, then execution history.
          </CardDescription>
        </div>
      )}
      {!lockedView && (
        <nav
          className={cn(
            'flex min-w-0 snap-x gap-1 overflow-x-auto overscroll-x-contain [mask-image:linear-gradient(to_right,#000_calc(100%-1rem),transparent)] [scrollbar-width:none] sm:[mask-image:none] [&::-webkit-scrollbar]:hidden',
            !embedded && 'border-b pb-1',
          )}
          aria-label="Automation views"
        >
          <AutomationViewButton
            active={activeView === 'builder'}
            label={editing ? 'Editing flow' : 'New flow'}
            onClick={() => onViewChange('builder')}
          />
          <AutomationViewButton
            active={activeView === 'recipes'}
            label="Saved"
            count={recipeCount}
            onClick={() => onViewChange('recipes')}
          />
          <AutomationViewButton active={activeView === 'runs'} label="Runs" count={runCount} onClick={() => onViewChange('runs')} />
          <AutomationViewButton
            active={activeView === 'executions'}
            label="Log"
            count={executionCount}
            onClick={() => onViewChange('executions')}
          />
        </nav>
      )}
    </CardHeader>
  )
}

function AutomationRuntimeBanner({
  embedded,
  runtime,
  busy,
  onToggle,
}: {
  embedded: boolean
  runtime: AutomationRuntimeStatus | null
  busy: string
  onToggle(): void
}) {
  if (!runtime) return null
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-b px-3 py-2',
        runtime.paused && 'bg-amber-500/10',
        embedded && 'mt-2 rounded-md border bg-card',
      )}
    >
      <div className="min-w-0">
        <strong className="text-xs">{runtime.paused ? 'Automation is paused' : 'Automation is running'}</strong>
        <p className="truncate text-[11px] text-muted-foreground">
          {runtime.activeRuns} of {runtime.maximumConcurrentRuns} concurrent flows active
          {runtime.reason ? ` · ${runtime.reason}` : ''}
        </p>
      </div>
      <Button type="button" size="xs" variant={runtime.paused ? 'default' : 'ghost'} disabled={busy === 'runtime'} onClick={onToggle}>
        <Power className="size-3.5" />
        {runtime.paused ? 'Resume' : 'Pause'}
      </Button>
    </div>
  )
}

function AutomationViewContent({
  activeView,
  actions,
  auditEvents,
  choices,
  conditionFields,
  draftState,
  embedded,
  executions,
  recipeNames,
  recipes,
  repositories,
  templates,
  trigger,
  triggerNames,
  triggers,
  visibleRuns,
}: {
  activeView: AutomationView
  actions: ReturnType<typeof useAutomationActions>
  auditEvents: AutomationAuditEvent[]
  choices: ReturnType<typeof automationCapabilityChoices>
  conditionFields: ReturnType<typeof automationConditionFields>
  draftState: ReturnType<typeof useAutomationDraft>
  embedded: boolean
  executions: CapabilityExecution[]
  recipeNames: Record<number, string>
  recipes: AutomationRecipe[]
  repositories: Array<Pick<Repository, 'id' | 'full_name'>>
  templates: RecipeTemplate[]
  trigger: CapabilityOption | undefined
  triggerNames: Record<string, string>
  triggers: CapabilityOption[]
  visibleRuns: AutomationFlowRun[]
}) {
  const { draft, setDraft, resetDraft, updateStep, chooseTrigger, chooseThreadAction, applyTemplate, edit } = draftState
  const { busy, save, run, toggle, remove, resolveImprovements } = actions
  const content: Record<AutomationView, ReactNode> = {
    builder: (
      <RecipeEditor
        editingId={draft.editingId}
        name={draft.name}
        description={draft.description}
        triggerId={draft.triggerId}
        trigger={trigger}
        triggers={triggers}
        conditionMode={draft.conditionMode}
        conditions={draft.conditions}
        conditionFields={conditionFields}
        threadAction={draft.threadAction}
        agentOptions={{
          agentId: draft.agentId,
          model: draft.model,
          reasoningEffort: draft.reasoningEffort,
          serviceTier: draft.serviceTier,
          allowSubagents: false,
        }}
        promptSteps={draft.promptSteps}
        boundActions={draft.boundActions}
        schedule={draft.schedule}
        steps={draft.steps}
        repositories={repositories}
        choices={choices}
        templates={templates}
        busy={busy}
        onNameChange={(value) => setDraft((current) => ({ ...current, name: value }))}
        onDescriptionChange={(value) => setDraft((current) => ({ ...current, description: value }))}
        onTriggerChange={chooseTrigger}
        onConditionModeChange={(value) => setDraft((current) => ({ ...current, conditionMode: value }))}
        onConditionsChange={(value) => setDraft((current) => ({ ...current, conditions: value }))}
        onThreadActionChange={chooseThreadAction}
        onAgentOptionsChange={(value) =>
          setDraft((current) => ({
            ...current,
            agentId: value.agentId,
            model: value.model,
            reasoningEffort: value.reasoningEffort,
            serviceTier: value.serviceTier || '',
          }))
        }
        onPromptStepsChange={(value) => setDraft((current) => ({ ...current, promptSteps: value }))}
        onBoundActionsChange={(value) => setDraft((current) => ({ ...current, boundActions: value }))}
        onScheduleChange={(value) => setDraft((current) => ({ ...current, schedule: value }))}
        onStepChange={updateStep}
        onStepsChange={(value) => setDraft((current) => ({ ...current, steps: value }))}
        onApplyTemplate={applyTemplate}
        onReset={resetDraft}
        onSave={save}
      />
    ),
    recipes: (
      <RecipeList
        recipes={recipes}
        editingId={draft.editingId}
        busy={busy}
        triggerNames={triggerNames}
        onEdit={edit}
        onRun={(recipe) => void run(recipe)}
        onToggle={(recipe) => void toggle(recipe)}
        onRemove={(recipe) => void remove(recipe)}
      />
    ),
    runs: (
      <>
        <FlowRunList
          runs={visibleRuns}
          recipeNames={recipeNames}
          busy={busy}
          onResolve={(flowRun, selectedIds) => void resolveImprovements(flowRun, selectedIds)}
        />
        <AutomationAuditList events={auditEvents} />
      </>
    ),
    executions: (
      <>
        <ExecutionList executions={executions} />
        <AutomationAuditList events={auditEvents} />
      </>
    ),
  }
  return <div className={cn('min-w-0 bg-muted/[.04]', embedded && 'bg-transparent')}>{content[activeView]}</div>
}

function AutomationViewButton({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        active && 'bg-primary text-primary-foreground shadow-xs',
      )}
    >
      {label}
      {count !== undefined && (
        <span className={cn('rounded px-1 font-mono text-xs', active ? 'bg-primary-foreground/15' : 'bg-muted')}>{count}</span>
      )}
    </button>
  )
}

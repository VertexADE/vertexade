import { useEffect, useMemo, useState } from 'react'
import type {
  AutomationCondition,
  AutomationAuditEvent,
  AutomationConditionMode,
  AutomationConditionOperator,
  AutomationFlowRun,
  AutomationRecipe,
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

export function RecipeStepEditor({
  step,
  index,
  removable,
  choices,
  conditionFields,
  onChange,
  onRemove,
}: {
  step: DraftStep
  index: number
  removable: boolean
  choices: Record<string, CapabilityOption[]>
  conditionFields: ConditionField[]
  onChange(index: number, value: Partial<DraftStep>): void
  onRemove(index: number): void
}) {
  const kinds = Object.keys(choices)
  return (
    <div className="space-y-2 rounded-lg border bg-background p-2">
      <div className="grid grid-cols-[7rem_minmax(0,1fr)_auto] gap-2">
        <Select value={step.kind} onValueChange={(value) => onChange(index, { kind: value as CapabilityKind, capabilityId: '' })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {kind}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={step.capabilityId || undefined} onValueChange={(value) => onChange(index, { capabilityId: value })}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={`Choose ${step.kind}`} />
          </SelectTrigger>
          <SelectContent>
            {(choices[step.kind] || []).map((capability) => (
              <SelectItem key={capability.id} value={capability.id}>
                {capability.name} · {capability.moduleId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="ghost" size="icon-sm" disabled={!removable} onClick={() => onRemove(index)}>
          <X />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Select value={step.inputSource} onValueChange={(value) => onChange(index, { inputSource: value as AutomationStepInputSource })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="trigger">Trigger payload</SelectItem>
            {index > 0 && <SelectItem value="previous">Previous output</SelectItem>}
            <SelectItem value="literal">Literal JSON</SelectItem>
          </SelectContent>
        </Select>
        {step.inputSource === 'literal' ? (
          <Label className="relative block">
            <Braces className="absolute left-2 top-2 size-3.5 text-muted-foreground" />
            <Textarea
              required
              value={step.input}
              onChange={(event) => onChange(index, { input: event.target.value })}
              placeholder="JSON input"
              className="min-h-14 pl-7 font-mono text-xs"
            />
          </Label>
        ) : (
          <p className="self-center text-xs text-muted-foreground">
            {step.inputSource === 'previous' ? 'Receives the prior capability output.' : 'Receives the matching event payload.'}
          </p>
        )}
      </div>
      <ConditionBuilder
        conditions={step.conditions}
        mode={step.conditionMode}
        fields={conditionFields}
        title="Run only if"
        description="Skip this step unless the previous capability output matches."
        onConditionsChange={(conditions) => onChange(index, { conditions })}
        onModeChange={(conditionMode) => onChange(index, { conditionMode })}
      />
    </div>
  )
}

export function RecipeSteps({
  steps,
  choices,
  canRemoveLast,
  onChange,
  onStepsChange,
}: {
  steps: DraftStep[]
  choices: Record<string, CapabilityOption[]>
  canRemoveLast: boolean
  onChange(index: number, value: Partial<DraftStep>): void
  onStepsChange(value: DraftStep[]): void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <strong className="text-xs">Checks before the run</strong>
          <p className="text-xs text-muted-foreground">
            Optional gates or evidence checks before the agent run starts. Agent work belongs in prompt phases.
          </p>
        </div>
        <Button type="button" size="xs" variant="outline" onClick={() => onStepsChange([...steps, emptyStep()])}>
          <Plus />
          Add check
        </Button>
      </div>
      {!steps.length && (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          No extra checks. Matching events start the agent flow immediately.
        </p>
      )}
      {steps.map((step, index) => {
        const previous =
          index > 0
            ? (choices[steps[index - 1]!.kind] || []).find((capability) => capability.id === steps[index - 1]!.capabilityId)
            : undefined
        const conditionFields = [
          { value: 'previous', label: 'Previous output', type: 'object' as const },
          ...schemaFields(previous?.outputSchema, 'previous', 'Previous output'),
        ]
        return (
          <RecipeStepEditor
            key={index}
            step={step}
            index={index}
            removable={steps.length > 1 || canRemoveLast}
            choices={choices}
            conditionFields={conditionFields}
            onChange={onChange}
            onRemove={(position) => onStepsChange(steps.filter((_, candidate) => candidate !== position))}
          />
        )
      })}
    </div>
  )
}

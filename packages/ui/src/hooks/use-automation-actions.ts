import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type { AutomationFlowRun, AutomationRecipe } from '@vertexade/platform-contracts'
import { toast } from 'sonner'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'
import {
  saveError,
  saveRequest,
  serializedBoundActions,
  serializedConditions,
  serializedSteps,
  type AutomationRuntimeStatus,
  type RecipeDraft,
} from '@vertexade/ui/components/automation-recipe-editor'
import { api } from '@vertexade/ui/lib/dashboard-api'

export function useAutomationActions({
  draft,
  resetDraft,
  load,
  runtime,
  setRuntime,
  onSaved,
}: {
  draft: RecipeDraft
  resetDraft(): void
  load(): Promise<unknown>
  runtime: AutomationRuntimeStatus | null
  setRuntime: Dispatch<SetStateAction<AutomationRuntimeStatus | null>>
  onSaved?(recipe: AutomationRecipe): void
}) {
  const confirmAction = useConfirm()
  const [busy, setBusy] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy('save')
    try {
      const request = saveRequest(draft.editingId)
      const recipe = await api<AutomationRecipe>(request.path, {
        method: request.method,
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          enabled: draft.enabled,
          triggerId: draft.triggerId === 'manual' ? null : draft.triggerId,
          conditionMode: draft.conditionMode,
          conditions: serializedConditions(draft.triggerId, draft.conditions),
          threadAction: draft.threadAction,
          agentId: draft.agentId || null,
          model: draft.model || null,
          reasoningEffort: draft.reasoningEffort || null,
          serviceTier: draft.serviceTier || null,
          allowSubagents: draft.allowSubagents,
          resourceSelection: draft.resourceSelection,
          promptSteps: draft.promptSteps,
          boundActions: serializedBoundActions(draft.boundActions),
          steps: serializedSteps(draft.steps),
          ...(draft.triggerId === 'core.scheduled' ? { schedule: draft.schedule } : {}),
        }),
      })
      toast.success(request.message)
      resetDraft()
      await load()
      onSaved?.(recipe)
    } catch (error) {
      toast.error(saveError(error))
    } finally {
      setBusy('')
    }
  }

  async function run(recipe: AutomationRecipe) {
    setBusy(`run:${recipe.id}`)
    try {
      const result = await api<{ started?: number; errors?: string[] }>(`/api/automation-recipes/${recipe.id}/run`, {
        method: 'POST',
        body: '{}',
      })
      toast.success(
        recipe.schedule && typeof result.started === 'number'
          ? `Started ${result.started} repository run${result.started === 1 ? '' : 's'}`
          : `${recipe.name} started`,
      )
      if (result.errors?.length) toast.warning(result.errors.join('\n'))
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function toggle(recipe: AutomationRecipe) {
    setBusy(`toggle:${recipe.id}`)
    try {
      await api(`/api/automation-recipes/${recipe.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...recipe, enabled: !recipe.enabled }),
      })
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function remove(recipe: AutomationRecipe) {
    const confirmed = await confirmAction({
      title: `Delete “${recipe.name}”?`,
      description: 'This permanently removes the recipe. Existing run history remains available.',
      confirmLabel: 'Delete automation',
      destructive: true,
    })
    if (!confirmed) return
    setBusy(`delete:${recipe.id}`)
    try {
      await api(`/api/automation-recipes/${recipe.id}`, { method: 'DELETE' })
      if (draft.editingId === recipe.id) resetDraft()
      toast.success('Automation deleted')
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function resolveImprovements(run: AutomationFlowRun, selectedImprovementIds: string[]) {
    setBusy(`approval:${run.id}`)
    try {
      await api(`/api/automation-runs/${run.id}/approval`, {
        method: 'POST',
        body: JSON.stringify({ selectedImprovementIds }),
      })
      toast.success(
        selectedImprovementIds.length
          ? `${selectedImprovementIds.length} improvement${selectedImprovementIds.length === 1 ? '' : 's'} approved`
          : 'Improve flow skipped',
      )
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function toggleRuntime() {
    if (!runtime) return
    setBusy('runtime')
    const paused = !runtime.paused
    try {
      const result = await api<AutomationRuntimeStatus>('/api/automation-runtime', {
        method: 'POST',
        body: JSON.stringify({ paused, reason: paused ? 'Paused manually from Settings' : '' }),
      })
      setRuntime(result)
      toast.success(paused ? 'New automation flows paused' : 'Automation flows resumed')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  return { busy, save, run, toggle, remove, resolveImprovements, toggleRuntime }
}

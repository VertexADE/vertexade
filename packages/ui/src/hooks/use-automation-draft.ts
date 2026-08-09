import { useState } from 'react'
import type { AutomationRecipe, AutomationThreadAction } from '@vertexade/platform-contracts'
import {
  automationDraftFromRecipe,
  automationDraftWithStep,
  automationDraftWithTemplate,
  automationDraftWithThreadAction,
  automationDraftWithTrigger,
} from '../components/automation-recipes-model'
import {
  emptyDraft,
  type CapabilityOption,
  type DraftStep,
  type RecipeDraft,
  type RecipeTemplate,
} from '@vertexade/ui/components/automation-recipe-editor'

export function useAutomationDraft(triggers: CapabilityOption[], onEdit: () => void) {
  const [draft, setDraft] = useState<RecipeDraft>(emptyDraft)
  const resetDraft = () => setDraft(emptyDraft())
  const updateStep = (index: number, value: Partial<DraftStep>) => setDraft((current) => automationDraftWithStep(current, index, value))
  const chooseTrigger = (value: string) => setDraft((current) => automationDraftWithTrigger(current, value, triggers))
  const chooseThreadAction = (value: AutomationThreadAction) => setDraft((current) => automationDraftWithThreadAction(current, value))
  const applyTemplate = (template: RecipeTemplate) => setDraft((current) => automationDraftWithTemplate(current, template))
  const edit = (recipe: AutomationRecipe) => {
    onEdit()
    setDraft(automationDraftFromRecipe(recipe))
    requestAnimationFrame(() => document.getElementById('automation-recipe-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  return { draft, setDraft, resetDraft, updateStep, chooseTrigger, chooseThreadAction, applyTemplate, edit }
}

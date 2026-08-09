import { contextualConfirmationValue, type ContextualActionEntity, type ResolvedContextualAction } from './contextual-actions.ts'

export function selectedReviewAction(actions: ResolvedContextualAction[], selectedId: string) {
  const selected = actions.find((action) => action.id === selectedId && action.enabled)
  if (selected) return selected
  return (
    actions.find((action) => action.enabled && action.tone === 'positive') ||
    actions.find((action) => action.enabled && !['warning', 'destructive'].includes(action.tone || 'default')) ||
    actions.find((action) => action.enabled) ||
    actions[0]
  )
}

export function reviewActionReady(
  action: ResolvedContextualAction,
  entity: ContextualActionEntity,
  fieldValues: Record<string, string>,
  confirmation: string,
) {
  if (!action.enabled) return false
  const fieldsComplete = (action.inputFields || []).every((field) => !field.required || Boolean(fieldValues[field.name]?.trim()))
  if (!fieldsComplete) return false
  return action.confirmation?.level !== 'typed' || confirmation === contextualConfirmationValue(action, entity)
}

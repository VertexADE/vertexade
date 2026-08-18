import { describe, expect, it } from 'vite-plus/test'
import type { AutomationFlowRun } from '@vertexade/platform-contracts'
import { emptyDraft, type CapabilityOption, type RecipeTemplate } from './automation-recipe-editor'
import {
  automationCapabilityChoices,
  automationDraftWithTemplate,
  automationDraftWithThreadAction,
  automationDraftWithTrigger,
  visibleAutomationRuns,
} from './automation-recipes-model'

const capability = (id: string, kind: CapabilityOption['kind'], enabled = true) =>
  ({ id, kind, enabled, name: id, moduleId: 'test' }) as CapabilityOption

describe('automation recipe projections', () => {
  it('groups enabled non-trigger capabilities by kind', () => {
    const choices = automationCapabilityChoices([
      capability('trigger', 'trigger'),
      capability('action', 'action'),
      capability('disabled', 'action', false),
    ])
    expect(choices.action?.map(({ id }) => id)).toEqual(['action'])
    expect(choices.trigger).toBeUndefined()
  })

  it('preserves schedule fields while clearing event conditions for the scheduled trigger', () => {
    const draft = { ...emptyDraft(), conditions: [{ field: 'state', operator: 'equals' as const, value: 'open' }] }
    const scheduled = automationDraftWithTrigger(draft, 'core.scheduled', [capability('core.scheduled', 'trigger')])
    expect(scheduled.schedule).not.toBeNull()
    expect(scheduled.conditions).toEqual([])
    expect(automationDraftWithTrigger(scheduled, 'manual', []).schedule).toEqual(scheduled.schedule)
  })

  it('applies templates and removes guarded actions when the thread outcome is disabled', () => {
    const template = {
      id: 'template',
      moduleId: 'test',
      moduleName: 'Test',
      name: 'Template',
      description: 'Description',
      threadAction: 'work',
      promptSteps: [{ name: 'Act', prompt: 'Do it' }],
    } as RecipeTemplate
    const templated = automationDraftWithTemplate(emptyDraft(), template)
    expect(templated).toMatchObject({ name: 'Template', threadAction: 'work' })
    expect(automationDraftWithThreadAction({ ...templated, boundActions: [{} as never] }, 'none').boundActions).toEqual([])
  })

  it('separates approval runs from history without changing source order', () => {
    const runs = [
      { id: 1, improvementApprovalStatus: 'pending', status: 'running' },
      { id: 2, improvementApprovalStatus: 'approved', status: 'succeeded' },
      { id: 3, improvementApprovalStatus: null, status: 'failed' },
      { id: 4, improvementApprovalStatus: null, status: 'running' },
    ] as AutomationFlowRun[]
    expect(visibleAutomationRuns(runs, 'approval').map(({ id }) => id)).toEqual([1])
    expect(visibleAutomationRuns(runs, 'history').map(({ id }) => id)).toEqual([2, 3])
    expect(visibleAutomationRuns(runs, undefined)).toBe(runs)
  })
})

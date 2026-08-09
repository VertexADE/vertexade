import type { PortableItemAction } from '@vertexade/platform-contracts'
import type { PortableCollectionItem } from '@vertexade/platform-contracts/portable'
import { actionInputOptions, actionValueMissing, defaultValue, normalizeActionValue, visibleInputs } from './portable-action-values'
import { actionAgentHeaders, completionAction, initialActionValues } from './portable-action-workflow'

const item = {
  id: 'work-1',
  title: 'Work 1',
  subtitle: '',
  fields: [],
  raw: { repository: 'VertexADE/core', owner: { id: 7 }, choices: [{ code: 'only' }] },
  depth: 0,
} satisfies PortableCollectionItem

function action(overrides: Partial<PortableItemAction> = {}): PortableItemAction {
  return {
    id: 'launch',
    label: 'Launch',
    method: 'POST',
    path: '/launch/{id}',
    ...overrides,
  }
}

describe('portable action values', () => {
  test('creates type-appropriate defaults and normalizes transport values', () => {
    expect(defaultValue({ name: 'enabled', label: 'Enabled', type: 'boolean' })).toBe(false)
    expect(defaultValue({ name: 'labels', label: 'Labels', type: 'multiselect' })).toEqual([])
    expect(defaultValue({ name: 'title', label: 'Title', type: 'text' })).toBe('')
    expect(defaultValue({ name: 'count', label: 'Count', type: 'number', defaultValue: 3 })).toBe(3)
    expect(normalizeActionValue(['one', 2])).toEqual(['one', '2'])
    expect(normalizeActionValue(null)).toBe('')
  })

  test('detects missing values and conditional visibility', () => {
    expect(actionValueMissing([])).toBe(true)
    expect(actionValueMissing(false)).toBe(false)
    expect(
      visibleInputs(
        [
          { name: 'mode', label: 'Mode', type: 'select' },
          { name: 'review', label: 'Review', type: 'text', visibleWhen: { input: 'mode', equals: 'review' } },
          { name: 'deploy', label: 'Deploy', type: 'text', visibleWhen: { input: 'mode', notEquals: 'review' } },
        ],
        { mode: 'review' },
      ).map((input) => input.name),
    ).toEqual(['mode', 'review'])
  })

  test('projects declared and data-backed options', () => {
    const declared = [{ value: 'one', label: 'One' }]
    expect(actionInputOptions({ name: 'choice', label: 'Choice', type: 'select', options: declared }, {}, item)).toBe(declared)
    expect(
      actionInputOptions(
        { name: 'choice', label: 'Choice', type: 'select', optionsSource: 'item', optionsPath: 'choices' },
        { choices: [{ code: 'surface' }] },
        item,
      ),
    ).toEqual([{ code: 'only' }])
  })
})

describe('portable action workflow', () => {
  test('resolves item, surface, single-option, and scalar defaults', () => {
    const values = initialActionValues(
      action({
        inputs: [
          { name: 'repository', label: 'Repository', type: 'text', defaultPath: 'repository', defaultSource: 'item' },
          { name: 'team', label: 'Team', type: 'text', defaultPath: 'team.id', defaultSource: 'surface' },
          {
            name: 'choice',
            label: 'Choice',
            type: 'select',
            optionsSource: 'item',
            optionsPath: 'choices',
            optionValuePath: 'code',
          },
          { name: 'urgent', label: 'Urgent', type: 'boolean' },
        ],
      }),
      { team: { id: 42 } },
      item,
    )
    expect(values).toEqual({ repository: 'VertexADE/core', team: 42, choice: 'only', urgent: false })
  })

  test('adds only selected agent execution headers for launch actions', () => {
    expect(actionAgentHeaders(action(), { agentId: 'codex', model: 'gpt', reasoningEffort: 'high' })).toBeUndefined()
    expect(
      actionAgentHeaders(action({ intent: 'launch-work' }), { agentId: 'codex', model: '', reasoningEffort: 'high' }),
    ).toEqual({ headers: { 'x-agent-provider': 'codex', 'x-agent-reasoning-effort': 'high' } })
  })

  test('builds a completion action with result mapping and declared defaults', () => {
    const result = completionAction(
      action({
        job: {
          idPath: 'job.id',
          statusPath: '/jobs/{id}',
          statusValuePath: 'status',
          completedValues: ['completed'],
          failedValues: ['failed'],
          resultBodyPath: ['payload', 'result'],
          completeAction: {
            id: 'complete',
            label: 'Complete',
            method: 'PATCH',
            path: '/work/{id}',
            inputs: [{ name: 'owner', label: 'Owner', type: 'hidden', defaultPath: 'owner.id', defaultSource: 'item' }],
          },
        },
      }),
      item,
      {},
    )
    expect(result?.resultName).toBe('__workflow_result')
    expect(result?.values).toEqual({ owner: 7 })
    expect(result?.completeAction.inputs?.at(-1)).toEqual({
      name: '__workflow_result',
      label: 'Workflow result',
      type: 'hidden',
      bodyPath: ['payload', 'result'],
    })
  })
})

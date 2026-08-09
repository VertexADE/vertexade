import { describe, expect, it } from 'vite-plus/test'
import { auditActionCandidateStatus, interactionExpression, interactionSteps } from './ui-audit-actions.mjs'

describe('UI audit actions', () => {
  it('prefers stable selectors and preserves their order', () => {
    expect(
      interactionSteps({
        actionSelectors: ['[data-audit-action="work.actions.open"]', '[data-audit-action="work.thread.new-agent"]'],
        clickText: 'Mutable label',
      }),
    ).toEqual([
      { kind: 'selector', value: '[data-audit-action="work.actions.open"]' },
      { kind: 'selector', value: '[data-audit-action="work.thread.new-agent"]' },
    ])
  })

  it('keeps legacy label locators for routes not yet migrated', () => {
    expect(interactionSteps({ clickTexts: ['Saved', 'Runs'] })).toEqual([
      { kind: 'label', value: 'Saved' },
      { kind: 'label', value: 'Runs' },
    ])
  })

  it('rejects missing, ambiguous, and disabled actions', () => {
    expect(auditActionCandidateStatus([])).toEqual({ ok: false, reason: 'Action was not rendered' })
    expect(
      auditActionCandidateStatus([
        { visible: true, disabled: false, label: 'One' },
        { visible: true, disabled: false, label: 'Two' },
      ]),
    ).toEqual({ ok: false, reason: 'Action matched 2 visible controls' })
    expect(auditActionCandidateStatus([{ visible: true, disabled: true, label: 'Disabled' }])).toEqual({
      ok: false,
      reason: 'Action was disabled',
    })
  })

  it('ignores hidden candidates and reports the current accessible label', () => {
    expect(
      auditActionCandidateStatus([
        { visible: false, disabled: false, label: 'Hidden' },
        { visible: true, disabled: false, label: 'New agent thread' },
      ]),
    ).toEqual({ ok: true, label: 'New agent thread' })
  })

  it('serializes selector actions and strict failure behavior into the browser expression', () => {
    const expression = interactionExpression({
      actionSelectors: ['[data-audit-action="work.delete"]'],
      interactionReadySelector: '[data-audit-state="ready"]',
    })
    expect(expression).toContain('work.delete')
    expect(expression).toContain('data-audit-state')
    expect(expression).toContain('Action matched ')
    expect(expression).toContain('Action was disabled')
    expect(expression).toContain('surfaceText')
  })
})

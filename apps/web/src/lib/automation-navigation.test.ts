import { describe, expect, it } from 'vite-plus/test'
import { automationView } from './automation-navigation'

describe('automation navigation', () => {
  it.each(['builder', 'recipes', 'runs', 'executions'] as const)('keeps the %s view addressable', (view) => {
    expect(automationView(view)).toBe(view)
  })

  it.each(['scheduled', 'schedules'])('redirects the legacy %s view to the unified recipe list', (view) => {
    expect(automationView(view)).toBe('recipes')
  })

  it('ignores unknown views', () => {
    expect(automationView('design')).toBeUndefined()
    expect(automationView('settings')).toBeUndefined()
    expect(automationView(null)).toBeUndefined()
  })
})

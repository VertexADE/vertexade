import { describe, expect, it } from 'vite-plus/test'
import { advancedRecipeSummary } from './automation-recipe-advanced-options'

describe('automation recipe editor', () => {
  it('summarizes optional publishing and checks in plain language', () => {
    expect(advancedRecipeSummary(0, 0)).toBe('No publishing · no extra checks')
    expect(advancedRecipeSummary(1, 2)).toBe('1 publishing action · 2 extra checks')
  })
})

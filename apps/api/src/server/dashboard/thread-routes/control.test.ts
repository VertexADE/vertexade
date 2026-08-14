import { describe, expect, it } from 'vite-plus/test'
import { invalidFormAnswer } from './control.ts'

const select = { id: 'scope', type: 'select', options: [{ label: 'Focused', value: 'focused' }] }
const checkbox = { id: 'checks', type: 'checkbox', options: [{ label: 'Tests', value: 'tests' }] }

describe('form answer validation', () => {
  it('accepts one custom answer for a single-choice field', () => {
    expect(invalidFormAnswer(select, { scope: { answers: ['A custom scope'] } })).toBe(false)
  })

  it('accepts listed choices plus one custom answer for a checkbox field', () => {
    expect(invalidFormAnswer(checkbox, { checks: { answers: ['tests', 'Update the documentation'] } })).toBe(false)
  })

  it('rejects multiple custom checkbox answers', () => {
    expect(invalidFormAnswer(checkbox, { checks: { answers: ['First custom value', 'Second custom value'] } })).toBe(true)
  })
})

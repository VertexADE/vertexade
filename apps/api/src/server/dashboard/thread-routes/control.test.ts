import { describe, expect, it } from 'vite-plus/test'
import { invalidFormAnswer } from './control.ts'

const select = { id: 'scope', type: 'select' as const, options: [{ label: 'Focused', value: 'focused' }] }
const checkbox = { id: 'checks', type: 'checkbox' as const, options: [{ label: 'Tests', value: 'tests' }] }

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

  it('validates dedicated number, date, email, and URL fields', () => {
    expect(invalidFormAnswer({ id: 'count', type: 'number' }, { count: { answers: ['12'] } })).toBe(false)
    expect(invalidFormAnswer({ id: 'count', type: 'number' }, { count: { answers: ['twelve'] } })).toBe(true)
    expect(invalidFormAnswer({ id: 'date', type: 'date' }, { date: { answers: ['2026-08-17'] } })).toBe(false)
    expect(invalidFormAnswer({ id: 'date', type: 'date' }, { date: { answers: ['2026-02-30'] } })).toBe(true)
    expect(invalidFormAnswer({ id: 'email', type: 'email' }, { email: { answers: ['invalid'] } })).toBe(true)
    expect(invalidFormAnswer({ id: 'url', type: 'url' }, { url: { answers: ['https://vertexade.example'] } })).toBe(false)
    expect(invalidFormAnswer({ id: 'url', type: 'url' }, { url: { answers: ['javascript:alert(1)'] } })).toBe(true)
  })
})

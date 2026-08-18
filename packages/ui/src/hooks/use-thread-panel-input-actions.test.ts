import { describe, expect, it } from 'vite-plus/test'
import { checkboxAnswerValues } from './use-thread-panel-input-actions'

describe('checkbox answer values', () => {
  it('submits a custom answer only while Other remains selected', () => {
    expect(checkboxAnswerValues(['web', '__other__'], 'API')).toEqual(['web', 'API'])
    expect(checkboxAnswerValues(['web'], 'API')).toEqual(['web'])
  })
})

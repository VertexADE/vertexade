import { describe, expect, it } from 'vite-plus/test'
import { newAutomationSchedule, scheduleCadence } from './automation-schedule-editor'

describe('automation schedule configuration', () => {
  it('creates a recipe trigger configuration with safe defaults', () => {
    expect(newAutomationSchedule()).toMatchObject({
      repositoryIds: [],
      branchType: 'chore',
      scheduleMode: 'simple',
      simpleSchedule: 'daily',
      cronExpression: '0 9 * * *',
      allowSubagents: false,
    })
  })

  it('summarizes preset and custom cadences for the shared recipe list', () => {
    const schedule = newAutomationSchedule()
    expect(scheduleCadence(schedule)).toBe('Daily · 09:00')
    expect(scheduleCadence({ ...schedule, scheduleMode: 'cron', cronExpression: '0 7 * * 1-5' })).toBe('0 7 * * 1-5')
  })
})

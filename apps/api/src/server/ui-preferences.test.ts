import { describe, expect, it } from 'vite-plus/test'
import { defaultUiPreferences, normalizeUiPreferences, patchUiPreferences } from './ui-preferences.ts'

describe('UI preferences', () => {
  it('bounds and deduplicates persistent UI state', () => {
    expect(
      normalizeUiPreferences({
        focusOrder: [3, -1, 3, 2, '1'],
        extensionPins: ['azure-devops', 'azure-devops', '', 2],
        density: 'compact',
      }),
    ).toEqual({
      focusOrder: [3, 2],
      extensionPins: ['azure-devops'],
      extensionBoards: {},
      density: 'compact',
      work: {},
    })
  })

  it('normalizes durable extension board layouts', () => {
    expect(
      normalizeUiPreferences({
        extensionBoards: {
          'azure:work-items': {
            swimlaneOption: 'assignee',
            nestedSwimlanes: true,
            columnsByAxis: { State: { order: ['Active', 'Done', 'Active'], hidden: ['Removed'] } },
          },
        },
      }).extensionBoards,
    ).toEqual({
      'azure:work-items': {
        swimlaneOption: 'assignee',
        nestedSwimlanes: true,
        columnsByAxis: { State: { order: ['Active', 'Done'], hidden: ['Removed'] } },
      },
    })
  })

  it('patches nested Work defaults without clearing other preferences', () => {
    const current = { ...defaultUiPreferences, focusOrder: [4], work: { view: 'board' as const } }
    expect(patchUiPreferences(current, { work: { showDone: true } })).toEqual({
      ...current,
      work: { view: 'board', showDone: true },
    })
  })
})

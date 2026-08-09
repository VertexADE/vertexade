import { describe, expect, it } from 'vite-plus/test'
import { portableAzureItem } from './board.ts'

describe('Azure portable board projection', () => {
  it('keeps board interaction data without embedding detail-only documents', () => {
    const item = portableAzureItem(
      {
        id: 42,
        title: 'Improve mobile board',
        type: 'User Story',
        state: 'Active',
        board_column: 'Doing',
        description: 'A very large rich-text description',
        acceptance_criteria: 'A large acceptance document',
        assigned_to: { display_name: 'Ada' },
        iteration_path: 'Product\\Sprint 1',
        area_path: 'Product',
        tags: ['mobile'],
        parent_id: 7,
        url: 'https://dev.azure.com/example/item/42',
      },
      { 'User Story': ['New', 'Active', 'Done'] },
      {
        taskboard: {
          columns: [{ name: 'Doing' }, { name: 'Done' }],
          team: 'Product',
          iterationId: 'sprint-1',
        },
      },
    )

    expect(item).toMatchObject({
      id: 42,
      title: 'Improve mobile board',
      parent_id: 7,
      portable_title: 'User Story #42: Improve mobile board',
    })
    expect(item).not.toHaveProperty('description')
    expect(item).not.toHaveProperty('acceptance_criteria')
    expect(item.portable_fields.map((field: { name: string }) => field.name)).not.toContain('Description')
  })
})

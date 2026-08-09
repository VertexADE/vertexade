import { describe, expect, it } from 'vite-plus/test'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { acceptanceChecks, buildFocusTaskGroups, focusTaskSection, reorderFocusTasks, workSourceLabels } from './focus-task-model'
import { workItem } from './focus-test-fixtures'

describe('focus task queue', () => {
  it('separates moving, ready, blocked, and completed work', () => {
    const now = workItem(1, { state: 'active' })
    const ready = workItem(2)
    const blocked = workItem(3, {
      state: 'active',
      threads: [{ status: 'failed', input_questions: null } as WorkItem['threads'][number]],
    })
    const done = workItem(4, { state: 'done' })

    expect(focusTaskSection(now)).toBe('now')
    expect(focusTaskSection(ready)).toBe('ready')
    expect(focusTaskSection(blocked)).toBe('blocked')
    expect(focusTaskSection(done)).toBeNull()
    expect(buildFocusTaskGroups([ready, blocked, done, now]).map((group) => [group.id, group.items.map((item) => item.id)])).toEqual([
      ['now', [1]],
      ['ready', [2]],
      ['blocked', [3]],
    ])
  })

  it('prioritizes urgent work but preserves the saved personal order', () => {
    const normal = workItem(1, { state: 'active', priority: 'normal' })
    const urgent = workItem(2, { state: 'active', priority: 'urgent' })
    const high = workItem(3, { state: 'active', priority: 'high' })
    const items = [normal, urgent, high]

    expect(buildFocusTaskGroups(items)[0].items.map((item) => item.id)).toEqual([2, 3, 1])
    expect(reorderFocusTasks(items, [], 1, 2)).toEqual([1, 2, 3])
    expect(buildFocusTaskGroups(items, [1, 2, 3])[0].items.map((item) => item.id)).toEqual([1, 2, 3])
  })

  it('extracts real markdown acceptance checks and external sources', () => {
    const item = workItem(1, {
      description: 'Outcome\n- [x] Poll delta endpoint\n- [ ] Verify recovery',
      resources: [
        { provider: 'azure-devops', kind: 'work_item' },
        { provider: 'airtable', kind: 'record' },
        { provider: 'git', kind: 'branch' },
      ] as WorkItem['resources'],
    })

    expect(acceptanceChecks(item.description)).toEqual([
      { complete: true, label: 'Poll delta endpoint' },
      { complete: false, label: 'Verify recovery' },
    ])
    expect(workSourceLabels(item)).toEqual(['Azure Boards', 'Airtable'])
  })
})

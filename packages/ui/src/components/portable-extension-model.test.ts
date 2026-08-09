import { describe, expect, it } from 'vite-plus/test'
import type { PortableCollectionSurface, PortableSwimlaneConfig } from '@vertexade/platform-contracts'
import type { PortableCollectionItem } from '@vertexade/platform-contracts/portable'
import {
  defaultPortableBoardPreferences,
  filterPortableItems,
  portableBoardPreferenceKey,
  portablePagination,
  projectPortableGroups,
  validPortableBoardPreferences,
} from './portable-extension-model'

const item = (id: string, title: string, state: string, parentId?: string): PortableCollectionItem => ({
  id,
  title,
  subtitle: '',
  fields: [{ name: 'State', value: state, relations: [], placement: 'card', style: 'text' }],
  raw: {},
  ...(parentId ? { parentId } : {}),
  depth: 0,
})

const facets = [{ id: 'state', label: 'State', field: 'State' }] as PortableCollectionSurface['facets']

describe('portable collection projection', () => {
  it('scopes board preferences and repairs a removed swimlane option', () => {
    const swimlanes = {
      defaultOption: 'team',
      nestedByDefault: true,
      options: [{ id: 'team' }, { id: 'owner' }],
    } as PortableSwimlaneConfig
    const fallback = defaultPortableBoardPreferences(swimlanes)
    expect(portableBoardPreferenceKey('github', 'issues')).toBe('github:issues')
    expect(validPortableBoardPreferences({ ...fallback, swimlaneOption: 'removed' }, fallback, swimlanes)).toEqual(fallback)
  })

  it('filters facets and retains hierarchy-aware sorting', () => {
    const items = [item('2', 'Child', 'Doing', '1'), item('1', 'Parent', 'Doing'), item('3', 'Other', 'Done')]
    expect(filterPortableItems(items, '', 'title', { state: 'Doing' }, facets).map(({ id }) => id)).toEqual(['1', '2'])
    expect(filterPortableItems(items, 'other', 'title', {}, facets).map(({ id }) => id)).toEqual(['3'])
  })

  it('applies group order, hidden columns, and pagination without losing counts', () => {
    const items = [item('1', 'A', 'Doing'), item('2', 'B', 'Done'), item('3', 'C', 'Doing')]
    const { baseGroups, groups } = projectPortableGroups(items, 'State', ['Doing', 'Done', 'Todo'], {
      order: ['Done', 'Doing'],
      hidden: ['Todo'],
    })
    expect(baseGroups.map(({ name }) => name)).toEqual(['Doing', 'Done', 'Todo'])
    expect(groups.map(({ name }) => name)).toEqual(['Done', 'Doing'])
    expect(portablePagination('kanban', items, groups, 'Doing', 1, true)).toMatchObject({
      displayable: 3,
      displayed: 2,
      remaining: 1,
      mobileTotal: 2,
      mobileDisplayed: 1,
      mobileRemaining: 1,
    })
  })
})

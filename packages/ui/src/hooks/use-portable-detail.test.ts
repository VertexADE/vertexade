import { describe, expect, it } from 'vite-plus/test'
import type { PortableCollectionSurface } from '@vertexade/platform-contracts'
import type { PortableCollectionItem } from '@vertexade/platform-contracts/portable'
import { portableDetailItem } from './use-portable-detail'

const surface = { detail: { titlePath: 'fields.name' } } as PortableCollectionSurface

describe('portable detail projection', () => {
  it('merges detail data into an item already present on the board', () => {
    const board = { id: '7', title: 'Board title', raw: { state: 'open' }, fields: [], subtitle: '', depth: 0 } as PortableCollectionItem
    expect(portableDetailItem('7', board, { owner: 'Ada' }, surface)?.raw).toEqual({ state: 'open', owner: 'Ada' })
  })

  it('projects a route-backed detail that is not on the current page', () => {
    expect(portableDetailItem('8', null, { fields: { name: 'Remote item' } }, surface)).toMatchObject({ id: '8', title: 'Remote item' })
    expect(portableDetailItem('8', null, null, surface)).toBeNull()
  })
})

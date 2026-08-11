import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { DataTable, type DataTableColumn } from '@vertexade/ui/components/ui/table'

type ExampleRow = {
  id: string
  name: string
  state: 'ready' | 'waiting'
}

describe('DataTable', () => {
  it('renders typed columns and stable rows through TanStack Table', () => {
    const columns: DataTableColumn<ExampleRow>[] = [
      {
        id: 'name',
        header: 'Name',
        cell: ({ row }) => row.original.name,
      },
      {
        id: 'state',
        header: 'State',
        cell: ({ row }) => row.original.state,
      },
    ]
    const data: ExampleRow[] = [
      { id: 'alpha', name: 'Alpha', state: 'ready' },
      { id: 'beta', name: 'Beta', state: 'waiting' },
    ]

    const markup = renderToStaticMarkup(<DataTable columns={columns} data={data} getRowId={(row) => row.id} />)

    expect(markup).toContain('data-table-engine="tanstack"')
    expect(markup).toContain('<th')
    expect(markup).toContain('Name')
    expect(markup).toContain('Alpha')
    expect(markup).toContain('Beta')
    expect(markup.indexOf('Alpha')).toBeLessThan(markup.indexOf('Beta'))
  })
})

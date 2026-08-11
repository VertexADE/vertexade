import type { ReactNode } from 'react'
import { tableFeatures, useTable, type ColumnDef, type RowData } from '@tanstack/react-table'

import { cn } from '@vertexade/ui/lib/utils'

const dataTableFeatures = tableFeatures({})

export type DataTableColumn<TData extends RowData> = ColumnDef<typeof dataTableFeatures, TData>

export type DataTableProps<TData extends RowData> = {
  columns: DataTableColumn<TData>[]
  data: TData[]
  getRowId(row: TData, index: number): string
  caption?: ReactNode
  containerClassName?: string
  tableClassName?: string
  headerClassName?(columnId: string): string | undefined
  cellClassName?(columnId: string): string | undefined
  rowClassName?(row: TData): string | undefined
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
  caption,
  containerClassName,
  tableClassName,
  headerClassName,
  cellClassName,
  rowClassName,
}: DataTableProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
  })

  return (
    <div data-slot="table-container" data-table-engine="tanstack" className={cn('w-full overflow-x-auto', containerClassName)}>
      <table data-slot="table" className={cn('w-full min-w-max border-collapse text-sm', tableClassName)}>
        {caption ? <caption className="p-3 text-left text-xs text-muted-foreground">{caption}</caption> : null}
        <thead data-slot="table-header" className="border-y bg-muted/25">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} data-slot="table-row" className="border-b">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  data-slot="table-head"
                  scope="col"
                  colSpan={header.colSpan}
                  className={cn(
                    'h-9 whitespace-nowrap px-3 text-left align-middle text-xs font-medium text-muted-foreground',
                    headerClassName?.(header.column.id),
                  )}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody data-slot="table-body" className="[&_tr:last-child]:border-b-0">
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              data-slot="table-row"
              className={cn('border-b transition-colors hover:bg-muted/20', rowClassName?.(row.original))}
            >
              {row.getAllCells().map((cell) => (
                <td key={cell.id} data-slot="table-cell" className={cn('p-2 align-middle', cellClassName?.(cell.column.id))}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

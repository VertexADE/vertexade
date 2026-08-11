import { useMemo } from 'react'
import { GitBranch } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { DataTable, type DataTableColumn } from '@vertexade/ui/components/ui/table'
import { agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { buildDeliveryRows, type DeliveryRow } from './work-delivery-data'

function MatrixStatus({ value, empty = 'Not started' }: { value?: string | null; empty?: string }) {
  if (!value) return <span className="text-[11px] text-muted-foreground">{empty}</span>
  const successful = ['completed', 'approved', 'merged', 'deployed', 'succeeded'].includes(value)
  const failed = ['failed', 'closed', 'cancelled', 'timed-out'].includes(value)
  return (
    <Badge
      variant="outline"
      className={cn(
        'max-w-full capitalize',
        successful && 'border-emerald-500/35 text-emerald-400',
        failed && 'border-red-500/35 text-red-400',
      )}
    >
      <span className="truncate">{value.replaceAll('_', ' ')}</span>
    </Badge>
  )
}

function MobileDeliveryStep({ label, value, empty }: { label: string; value?: string | null; empty?: string }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <MatrixStatus value={value} empty={empty} />
    </div>
  )
}

function MobileDeliveryRow({ row }: { row: DeliveryRow }) {
  const workState = row.work ? agentThreadState(row.work) : null
  const reviewState = row.review ? agentThreadState(row.review) : null
  return (
    <div className="rounded-lg border bg-background/35 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="size-3.5 shrink-0 text-blue-400" />
        <strong className="truncate text-xs">{row.repository}</strong>
      </div>
      {row.work?.branch_name && <p className="mt-1 truncate pl-5 font-mono text-[11px] text-muted-foreground">{row.work.branch_name}</p>}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 min-[380px]:grid-cols-4">
        <MobileDeliveryStep label="Work" value={workState} />
        <MobileDeliveryStep label="PR" value={row.pullRequest?.state} empty="Not opened" />
        <MobileDeliveryStep label="Review" value={reviewState} />
        <MobileDeliveryStep
          label="Deploy"
          value={row.deployment?.state}
          empty={row.pullRequest?.state === 'merged' ? 'Waiting' : 'Not ready'}
        />
      </div>
    </div>
  )
}

export function DeliveryMatrix({ item }: { item: WorkItem }) {
  const rows = buildDeliveryRows(item)
  const columns = useMemo<DataTableColumn<DeliveryRow>[]>(
    () => [
      {
        id: 'repository',
        header: 'Repository',
        cell: ({ row }) => (
          <strong className="block truncate text-xs" title={row.original.repository}>
            {row.original.repository}
          </strong>
        ),
      },
      {
        id: 'work',
        header: 'Work',
        cell: ({ row }) => <MatrixStatus value={row.original.work ? agentThreadState(row.original.work) : null} />,
      },
      {
        id: 'branch',
        header: 'Branch',
        cell: ({ row }) => (
          <span className="block truncate font-mono text-[11px] text-muted-foreground" title={row.original.work?.branch_name || ''}>
            {row.original.work?.branch_name || 'Not created'}
          </span>
        ),
      },
      {
        id: 'pull-request',
        header: 'PR',
        cell: ({ row }) => <MatrixStatus value={row.original.pullRequest?.state} empty="Not opened" />,
      },
      {
        id: 'review',
        header: 'Review',
        cell: ({ row }) => <MatrixStatus value={row.original.review ? agentThreadState(row.original.review) : null} />,
      },
      {
        id: 'deployment',
        header: 'Deploy',
        cell: ({ row }) => (
          <MatrixStatus
            value={row.original.deployment?.state}
            empty={row.original.pullRequest?.state === 'merged' ? 'Waiting' : 'Not ready'}
          />
        ),
      },
    ],
    [],
  )
  if (!rows.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="size-4 text-blue-400" />
          Repository delivery <Badge variant="secondary">{rows.length}</Badge>
        </CardTitle>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Implementation, review, and release evidence for every connected repository.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="space-y-2 px-3 pb-3 md:hidden">
          {rows.map((row) => (
            <MobileDeliveryRow key={row.repository} row={row} />
          ))}
        </div>
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.repository}
          containerClassName="hidden [scrollbar-gutter:stable] md:block"
          tableClassName="min-w-[36rem] table-fixed 2xl:min-w-[44rem]"
          headerClassName={(columnId) =>
            cn(columnId === 'repository' ? 'w-[28%]' : 'w-[18%]', columnId === 'branch' && 'hidden 2xl:table-cell')
          }
          cellClassName={(columnId) => cn('min-w-0', columnId === 'branch' && 'hidden 2xl:table-cell')}
        />
      </CardContent>
    </Card>
  )
}

import * as React from 'react'

import { cn } from '@vertexade/ui/lib/utils'

function TableContainer({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="table-container" className={cn('w-full overflow-x-auto', className)} {...props} />
}

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return <table data-slot="table" className={cn('w-full min-w-max border-collapse text-sm', className)} {...props} />
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('border-y bg-muted/25', className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-b-0', className)} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('border-b transition-colors hover:bg-muted/20 data-[selected=true]:bg-muted/40', className)}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn('h-9 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground', className)}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('p-2 align-middle', className)} {...props} />
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('p-3 text-left text-xs text-muted-foreground', className)} {...props} />
}

export { TableContainer, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption }

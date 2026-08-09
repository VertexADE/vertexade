import { lazy } from 'react'

export const LazyPrDetailsDialog = lazy(() =>
  import('@vertexade/ui/components/pr-details-dialog').then(({ PrDetailsDialog }) => ({
    default: PrDetailsDialog,
  })),
)

export const LazyThreadDialog = lazy(() =>
  import('@vertexade/ui/components/thread-dialog').then(({ ThreadDialog }) => ({ default: ThreadDialog })),
)

import { useContext } from 'react'
import { createCollection, eq, useLiveQuery } from '@tanstack/react-db'
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection'
import type { RxCollection } from 'rxdb/plugins/core'
import type { DashboardCacheDocument, DashboardCollection } from './dashboard-cache-model'
import { DashboardDatabaseContext, type DashboardModelCollection } from './tanstack-dashboard-context'

function createDashboardCollection(rxCollection: RxCollection<DashboardCacheDocument>): DashboardModelCollection {
  return createCollection(
    rxdbCollectionOptions<DashboardCacheDocument>({
      id: 'dashboard-read-model',
      rxCollection,
      syncBatchSize: 500,
    }),
  )
}

let dashboardCollectionPromise: Promise<DashboardModelCollection> | undefined

export function dashboardCollection(): Promise<DashboardModelCollection> {
  dashboardCollectionPromise ??= import('./rxdb-dashboard-storage').then(async ({ getDashboardModelRxCollection }) =>
    createDashboardCollection(await getDashboardModelRxCollection()),
  )
  return dashboardCollectionPromise
}

export function useDashboardModelRows(bucket: DashboardCollection) {
  const collection = useContext(DashboardDatabaseContext)
  return useLiveQuery(
    (query) =>
      collection
        ? query
            .from({ model: collection })
            .where(({ model }) => eq(model.bucket, bucket))
            .orderBy(({ model }) => model.position)
        : undefined,
    [bucket, collection],
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { DashboardDatabaseContext, type DashboardModelCollection } from './tanstack-dashboard-context'

export function DashboardDatabaseProvider({ children }: { children: ReactNode }) {
  const [collection, setCollection] = useState<DashboardModelCollection | null>(null)

  useEffect(() => {
    let active = true
    void import('./tanstack-dashboard-db')
      .then(({ dashboardCollection }) => dashboardCollection())
      .then((value) => {
        if (active) setCollection(value)
      })
      .catch((reason: unknown) => {
        if (active) console.warn('Could not initialize the TanStack dashboard query layer:', reason)
      })
    return () => {
      active = false
    }
  }, [])

  return <DashboardDatabaseContext.Provider value={collection}>{children}</DashboardDatabaseContext.Provider>
}

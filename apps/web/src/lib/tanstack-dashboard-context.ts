import { createContext } from 'react'
import type { Collection } from '@tanstack/react-db'
import type { DashboardCacheDocument } from './dashboard-cache-model'

export type DashboardModelCollection = Collection<DashboardCacheDocument, string>

export const DashboardDatabaseContext = createContext<DashboardModelCollection | null>(null)

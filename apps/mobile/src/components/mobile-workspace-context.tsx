import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useMobileWorkspace } from './use-mobile-workspace'
import type { MobileConnectionCatalog } from './use-mobile-workspace'

type MobileWorkspaceState = ReturnType<typeof useMobileWorkspace>

const MobileWorkspaceContext = createContext<MobileWorkspaceState | null>(null)

export function MobileWorkspaceProvider({ children, connections }: { children: ReactNode; connections: MobileConnectionCatalog[] }) {
  const state = useMobileWorkspace(connections)
  return <MobileWorkspaceContext.Provider value={state}>{children}</MobileWorkspaceContext.Provider>
}

export function useMobileWorkspaceContext(): MobileWorkspaceState {
  const state = useContext(MobileWorkspaceContext)
  if (!state) throw new Error('useMobileWorkspaceContext must be used inside MobileWorkspaceProvider')
  return state
}

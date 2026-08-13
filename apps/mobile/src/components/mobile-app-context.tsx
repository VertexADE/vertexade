import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Platform } from 'react-native'
import { normalizePlatformBaseUrl } from '@vertexade/platform-client'
import { loadMobileServerCatalogs } from '@/platform-service'
import { redeemMobilePairLink } from '@/mobile-pairing'
import {
  readMobileSessionCatalog,
  renameMobileSession,
  selectMobileSession,
  type MobileSession,
} from '@/mobile-session'
import type { MobileConnectionCatalog } from './use-mobile-workspace'
import { registerMobileNotifications } from '@/mobile-notifications'
import { defaultMobileVoicePreferences, readMobileVoicePreferences, saveMobileVoicePreferences, type MobileVoicePreferences } from '@/mobile-voice-preferences'

const defaultServiceUrl = process.env.EXPO_PUBLIC_VERTEXADE_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:4173' : 'http://localhost:4173')

type ActiveConnection = { connections: MobileConnectionCatalog[] }

type MobileAppState = {
  connection: ActiveConnection | null
  connectionName: string
  error: string
  loading: boolean
  serviceUrl: string
  sessions: MobileSession[]
  voicePreferences: MobileVoicePreferences
  changeServiceUrl(value: string): void
  connect(): Promise<void>
  disconnect(): void
  renameServer(serviceUrl: string, name: string): Promise<void>
  selectServer(serviceUrl: string): Promise<void>
  setConnectionName(value: string): void
  updateVoicePreferences(value: MobileVoicePreferences): Promise<void>
}

const MobileAppContext = createContext<MobileAppState | null>(null)

export function MobileAppProvider({ children }: { children: ReactNode }) {
  const [serviceUrl, setServiceUrl] = useState('')
  const [connectionName, setConnectionName] = useState('')
  const [connection, setConnection] = useState<ActiveConnection | null>(null)
  const [sessions, setSessions] = useState<MobileSession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [voicePreferences, setVoicePreferences] = useState(defaultMobileVoicePreferences)
  const connectionSequence = useRef(0)

  useEffect(() => {
    void readMobileVoicePreferences().then(setVoicePreferences).catch(() => undefined)
  }, [])

  useEffect(() => {
    const sequence = ++connectionSequence.current
    let current = true
    void readMobileSessionCatalog()
      .then((catalog) => {
        setSessions(catalog.sessions)
        const session = catalog.sessions.find((candidate) => candidate.serviceUrl === catalog.activeServiceUrl)
        if (!session) return null
        setServiceUrl(session.serviceUrl)
        setLoading(true)
        return resolveConnections(catalog.sessions)
      })
      .then((next) => {
        if (next && current && connectionSequence.current === sequence) setConnection(next)
      })
      .catch((reason: unknown) => {
        if (current && connectionSequence.current === sequence) setError(connectionError(reason))
      })
      .finally(() => {
        if (current && connectionSequence.current === sequence) setLoading(false)
      })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (!connection) return
    void registerMobileNotifications(connection.connections.map(({ serviceUrl }) => serviceUrl))
  }, [connection])

  async function connect() {
    const sequence = ++connectionSequence.current
    setLoading(true)
    setError('')
    try {
      let target = serviceUrl || defaultServiceUrl
      if (looksLikePairLink(serviceUrl)) target = (await redeemMobilePairLink(serviceUrl, 'VertexADE Mobile', connectionName)).serviceUrl
      const catalog = await readMobileSessionCatalog()
      const next = await resolveConnections(catalog.sessions.length ? catalog.sessions : [{ serviceUrl: target }])
      if (connectionSequence.current !== sequence) return
      setSessions(catalog.sessions)
      setConnectionName('')
      setServiceUrl(next.connections[0]?.serviceUrl || target)
      setConnection(next)
    } catch (reason) {
      if (connectionSequence.current === sequence) {
        setConnection(null)
        setError(connectionError(reason))
      }
    } finally {
      if (connectionSequence.current === sequence) setLoading(false)
    }
  }

  async function selectServer(nextServiceUrl: string) {
    const sequence = ++connectionSequence.current
    setLoading(true)
    setError('')
    try {
      await selectMobileSession(nextServiceUrl)
      const catalog = await readMobileSessionCatalog()
      const next = await resolveConnections(catalog.sessions)
      if (connectionSequence.current === sequence) {
        setSessions(catalog.sessions)
        setServiceUrl(nextServiceUrl)
        setConnection(next)
      }
    } catch (reason) {
      if (connectionSequence.current === sequence) setError(connectionError(reason))
    } finally {
      if (connectionSequence.current === sequence) setLoading(false)
    }
  }

  function changeServiceUrl(value: string) {
    connectionSequence.current += 1
    setServiceUrl(value)
    setConnection(null)
    setError('')
  }

  async function renameServer(nextServiceUrl: string, name: string) {
    await renameMobileSession(nextServiceUrl, name)
    setSessions((await readMobileSessionCatalog()).sessions)
  }

  async function updateVoicePreferences(value: MobileVoicePreferences) {
    setVoicePreferences(value)
    await saveMobileVoicePreferences(value)
  }

  const value = useMemo<MobileAppState>(() => ({
    connection, connectionName, error, loading, serviceUrl, sessions, voicePreferences,
    changeServiceUrl,
    connect,
    disconnect: () => setConnection(null),
    renameServer,
    selectServer,
    setConnectionName,
    updateVoicePreferences,
  }), [connection, connectionName, error, loading, serviceUrl, sessions, voicePreferences])

  return <MobileAppContext.Provider value={value}>{children}</MobileAppContext.Provider>
}

export function useMobileApp(): MobileAppState {
  const value = useContext(MobileAppContext)
  if (!value) throw new Error('useMobileApp must be used inside MobileAppProvider')
  return value
}

export function useOptionalMobileApp(): MobileAppState | null {
  return useContext(MobileAppContext)
}

function looksLikePairLink(value: string): boolean {
  return /\/pair(?:#|$)/.test(value) || value.trim().startsWith('vertexade:')
}

async function resolveConnections(sessions: Array<Pick<MobileSession, 'serviceUrl' | 'name'>>): Promise<ActiveConnection> {
  const connections = await Promise.all(sessions.map(async (session): Promise<MobileConnectionCatalog> => {
    const serviceUrl = normalizePlatformBaseUrl(session.serviceUrl)
    try {
      const servers = await loadMobileServerCatalogs(serviceUrl)
      return {
        serviceUrl,
        ...(session.name ? { name: session.name } : {}),
        servers: servers.map((server) => session.name ? { ...server, label: session.name } : server),
      }
    } catch (reason) {
      return { serviceUrl, ...(session.name ? { name: session.name } : {}), servers: [], error: connectionError(reason) }
    }
  }))
  if (!connections.some((candidate) => !candidate.error)) throw new Error(connections[0]?.error || 'Could not connect to a VertexADE server')
  return { connections }
}

function connectionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Could not connect to the VertexADE service'
}

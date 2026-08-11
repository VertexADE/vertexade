import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { normalizePlatformBaseUrl } from '@vertexade/platform-client'
import { MobileConnectionPanel, MobileHomeHero } from '@/components/mobile-home-components'
import { mobileHomeStyles as styles } from '@/components/mobile-home-styles'
import { MobileWorkspaceScreen } from '@/components/mobile-workspace'
import { loadMobileServerCatalogs, type MobileServerCatalog } from '@/platform-service'
import { redeemMobilePairLink } from '@/mobile-pairing'
import { readMobileSession } from '@/mobile-session'

const defaultServiceUrl = process.env.EXPO_PUBLIC_VERTEXADE_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:4173' : 'http://localhost:4173')

type ActiveConnection = {
  serviceUrl: string
  servers: MobileServerCatalog[]
}

function looksLikePairLink(value: string): boolean {
  return /\/pair(?:#|$)/.test(value) || value.trim().startsWith('vertexade:')
}

async function resolveSubmittedConnection(value: string): Promise<ActiveConnection> {
  let target = value || defaultServiceUrl
  if (looksLikePairLink(value)) target = (await redeemMobilePairLink(value)).serviceUrl
  return resolveConnection(target)
}

export default function HomeScreen() {
  const [serviceUrl, setServiceUrl] = useState('')
  const [connection, setConnection] = useState<ActiveConnection | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const connectionSequence = useRef(0)

  useEffect(() => {
    const sequence = connectionSequence.current + 1
    connectionSequence.current = sequence
    let current = true
    void readMobileSession()
      .then((session) => {
        if (!session) return null
        setServiceUrl(session.serviceUrl)
        setLoading(true)
        return resolveConnection(session.serviceUrl)
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
    return () => {
      current = false
    }
  }, [])

  function commitConnection(sequence: number, next: ActiveConnection) {
    if (connectionSequence.current !== sequence) return
    setServiceUrl(next.serviceUrl)
    setConnection(next)
  }

  function failConnection(sequence: number, reason: unknown) {
    if (connectionSequence.current !== sequence) return
    setConnection(null)
    setError(connectionError(reason))
  }

  function finishConnection(sequence: number) {
    if (connectionSequence.current === sequence) setLoading(false)
  }

  async function connect() {
    const sequence = connectionSequence.current + 1
    connectionSequence.current = sequence
    setLoading(true)
    setError('')
    try {
      commitConnection(sequence, await resolveSubmittedConnection(serviceUrl))
    } catch (reason) {
      failConnection(sequence, reason)
    } finally {
      finishConnection(sequence)
    }
  }

  function changeServiceUrl(value: string) {
    connectionSequence.current += 1
    setServiceUrl(value)
    setConnection(null)
    setError('')
  }

  if (connection) return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <MobileWorkspaceScreen serviceUrl={connection.serviceUrl} servers={connection.servers} onChangeService={() => setConnection(null)} />
    </KeyboardAvoidingView>
  </SafeAreaView>

  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <MobileHomeHero />
        <MobileConnectionPanel serviceUrl={serviceUrl} loading={loading} error={error} onServiceUrlChange={changeServiceUrl} onConnect={() => void connect()} />
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>
}

async function resolveConnection(serviceUrl: string): Promise<ActiveConnection> {
  const normalizedServiceUrl = normalizePlatformBaseUrl(serviceUrl)
  const servers = await loadMobileServerCatalogs(normalizedServiceUrl)
  return { serviceUrl: normalizedServiceUrl, servers }
}

function connectionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Could not connect to the VertexADE service'
}

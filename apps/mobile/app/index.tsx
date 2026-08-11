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

const defaultServiceUrl = process.env.EXPO_PUBLIC_VERTEXADE_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:4173' : 'http://localhost:4173')

type ActiveConnection = {
  serviceUrl: string
  servers: MobileServerCatalog[]
}

export default function HomeScreen() {
  const [serviceUrl, setServiceUrl] = useState(defaultServiceUrl)
  const [connection, setConnection] = useState<ActiveConnection | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const connectionSequence = useRef(0)

  useEffect(() => {
    const sequence = connectionSequence.current + 1
    connectionSequence.current = sequence
    let current = true
    setLoading(true)
    void resolveConnection(defaultServiceUrl)
      .then((next) => {
        if (current && connectionSequence.current === sequence) setConnection(next)
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

  async function connect() {
    const sequence = connectionSequence.current + 1
    connectionSequence.current = sequence
    setLoading(true)
    setError('')
    try {
      const next = await resolveConnection(serviceUrl)
      if (connectionSequence.current === sequence) setConnection(next)
    } catch (reason) {
      if (connectionSequence.current === sequence) {
        setConnection(null)
        setError(connectionError(reason))
      }
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

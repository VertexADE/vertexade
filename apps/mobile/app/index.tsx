import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { ModuleCatalog } from '@vertexade/platform-contracts'
import { createPlatformClient, normalizePlatformBaseUrl } from '@vertexade/platform-client'
import { MobileConnectionPanel, MobileExtensionList, MobileHomeHero } from '@/components/mobile-home-components'
import { mobileHomeStyles as styles } from '@/components/mobile-home-styles'

const defaultServer = process.env.EXPO_PUBLIC_VERTEXADE_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:4174' : 'http://localhost:4174')

export default function HomeScreen() {
  const [server, setServer] = useState(defaultServer)
  const [catalog, setCatalog] = useState<ModuleCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function connect() {
    setLoading(true)
    setError('')
    try {
      const client = createPlatformClient({ baseUrl: normalizePlatformBaseUrl(server) })
      setCatalog(await client.modules.list())
    } catch (reason) {
      setCatalog(null)
      setError(reason instanceof Error ? reason.message : 'Could not connect to VertexADE')
    } finally {
      setLoading(false)
    }
  }

  const modules = catalog?.modules.filter((module) => module.portable && (module.portable.surfaces.length || module.portable.settings)) || []
  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <MobileHomeHero />
        <MobileConnectionPanel server={server} loading={loading} error={error} onServerChange={setServer} onConnect={() => void connect()} />
        {catalog && <MobileExtensionList modules={modules} server={server} />}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>
}

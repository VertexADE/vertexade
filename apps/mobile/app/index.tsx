import { Redirect } from 'expo-router'
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MobileConnectionPanel, MobileHomeHero } from '@/components/mobile-home-components'
import { mobileHomeStyles as styles } from '@/components/mobile-home-styles'
import { useMobileApp } from '@/components/mobile-app-context'

export default function HomeScreen() {
  const state = useMobileApp()

  if (state.connection) return <Redirect href="/(tabs)" />

  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <MobileHomeHero />
        <MobileConnectionPanel
          serviceUrl={state.serviceUrl}
          connectionName={state.connectionName}
          pairedServers={state.sessions}
          loading={state.loading}
          error={state.error}
          onServiceUrlChange={state.changeServiceUrl}
          onConnectionNameChange={state.setConnectionName}
          onConnect={() => void state.connect()}
          onSelectServer={(serviceUrl) => void state.selectServer(serviceUrl)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>
}

import { KeyboardAvoidingView, Platform } from 'react-native'
import { Redirect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { mobileHomeStyles } from './mobile-home-styles'
import { useMobileApp } from './mobile-app-context'
import { MobileWorkspaceScreen, type WorkspaceView } from './mobile-workspace'
import { useMobileWorkspaceContext } from './mobile-workspace-context'

export function MobileWorkspaceRoute({ view }: { view: WorkspaceView }) {
  const app = useMobileApp()
  const workspaceState = useMobileWorkspaceContext()
  if (!app.connection) return <Redirect href="/" />

  return <SafeAreaView edges={['top']} style={mobileHomeStyles.safe}>
    <KeyboardAvoidingView style={mobileHomeStyles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <MobileWorkspaceScreen
        connections={app.connection.connections}
        pairedServers={app.sessions}
        view={view}
        workspaceState={workspaceState}
        onAddServer={app.disconnect}
        onRenameServer={app.renameServer}
      />
    </KeyboardAvoidingView>
  </SafeAreaView>
}

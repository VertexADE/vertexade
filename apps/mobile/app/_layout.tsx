import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { StyleSheet, View } from 'react-native'
import { colors } from '@/theme'
import { MobileAppProvider } from '@/components/mobile-app-context'

export default function RootLayout() {
  return <SafeAreaProvider><KeyboardProvider><View style={styles.background}><MobileAppProvider>
    <StatusBar style="light" />
    <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      contentStyle: { backgroundColor: colors.background },
    }}>
      <Stack.Screen name="index" options={{ headerShown: false, title: 'VertexADE' }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="pair" options={{ title: 'Pair device', presentation: 'modal' }} />
      <Stack.Screen name="extensions/[moduleId]" options={{ title: 'Extension' }} />
    </Stack>
  </MobileAppProvider></View></KeyboardProvider></SafeAreaProvider>
}

const styles = StyleSheet.create({ background: { backgroundColor: colors.background, flex: 1 } })

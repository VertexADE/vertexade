import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { colors } from '@/theme'
import { MobileAppProvider } from '@/components/mobile-app-context'

export default function RootLayout() {
  return <SafeAreaProvider><MobileAppProvider>
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
  </MobileAppProvider></SafeAreaProvider>
}

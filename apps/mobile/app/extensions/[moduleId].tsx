import { useEffect, useState } from 'react'
import { Stack, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { ModuleCatalog, ModuleCatalogEntry, PortableCollectionSurface } from '@vertexade/platform-contracts'
import { createPlatformClient } from '@vertexade/platform-client'
import { PortableCollectionScreen } from '@/components/portable-collection-screen'
import { PortableSettingsScreen } from '@/components/portable-settings-screen'
import { MobileExtensionState, MobileExtensionTabs, mobileExtensionStyles as styles, type MobileExtensionMode } from '@/components/mobile-extension-chrome'

export default function ExtensionScreen() {
  const params = useLocalSearchParams<{ moduleId: string; server: string }>()
  const moduleId = Array.isArray(params.moduleId) ? params.moduleId[0] : params.moduleId
  const server = Array.isArray(params.server) ? params.server[0] : params.server
  const [module, setModule] = useState<ModuleCatalogEntry | null>(null)
  const [surface, setSurface] = useState<PortableCollectionSurface | null>(null)
  const [mode, setMode] = useState<MobileExtensionMode>('workspace')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!server || !moduleId) return
    const client = createPlatformClient({ baseUrl: server })
    void client.modules.list().then((catalog: ModuleCatalog) => {
      const match = catalog.modules.find((candidate) => candidate.id === moduleId) || null
      setModule(match)
      const collection = match?.portable?.surfaces.find((candidate): candidate is PortableCollectionSurface => candidate.kind === 'collection') || null
      setSurface(collection)
      if (!match?.enabled || !collection) setMode('settings')
      if (!match) setError('This extension is no longer installed.')
      else if (!collection && !match.portable?.settings) setError('This extension does not publish a portable surface.')
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load the extension'))
  }, [moduleId, server])

  return <SafeAreaView style={styles.safe}>
    <Stack.Screen options={{ title: module?.name || moduleId || 'Extension' }} />
    {error ? <MobileExtensionState title="Extension unavailable" text={error} />
      : module && server && (surface || module.portable?.settings) ? <>
        {surface && module.portable?.settings && <MobileExtensionTabs mode={mode} onChange={setMode} />}
        {mode === 'settings' && module.portable?.settings
          ? <PortableSettingsScreen module={module} server={server} settings={module.portable.settings} />
          : surface && module.enabled
            ? <PortableCollectionScreen module={module} server={server} surface={surface} />
            : module.portable?.settings
              ? <PortableSettingsScreen module={module} server={server} settings={module.portable.settings} />
              : null}
      </>
        : <MobileExtensionState loading text="Loading extension contract…" />}
  </SafeAreaView>
}

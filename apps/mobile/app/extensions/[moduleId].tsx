import { useEffect, useState } from 'react'
import { Stack, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { ModuleCatalog, ModuleCatalogEntry, PortableCollectionSurface } from '@vertexade/platform-contracts'
import { PortableCollectionScreen } from '@/components/portable-collection-screen'
import { PortableSettingsScreen } from '@/components/portable-settings-screen'
import { MobileExtensionState, MobileExtensionTabs, mobileExtensionStyles as styles, type MobileExtensionMode } from '@/components/mobile-extension-chrome'
import { createMobilePlatformClient } from '@/platform-service'

export default function ExtensionScreen() {
  const params = useLocalSearchParams<{ moduleId: string; serviceUrl: string; backendId: string }>()
  const moduleId = Array.isArray(params.moduleId) ? params.moduleId[0] : params.moduleId
  const serviceUrl = Array.isArray(params.serviceUrl) ? params.serviceUrl[0] : params.serviceUrl
  const backendId = Array.isArray(params.backendId) ? params.backendId[0] : params.backendId
  const [module, setModule] = useState<ModuleCatalogEntry | null>(null)
  const [surface, setSurface] = useState<PortableCollectionSurface | null>(null)
  const [mode, setMode] = useState<MobileExtensionMode>('workspace')
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setModule(null)
    setSurface(null)
    setMode('workspace')
    setError('')
    if (!serviceUrl || !backendId || !moduleId) {
      setError('This extension link is incomplete.')
      return () => {
        current = false
      }
    }
    try {
      const client = createMobilePlatformClient(serviceUrl, backendId)
      void client.modules.list().then((catalog: ModuleCatalog) => {
        if (!current) return
        const match = catalog.modules.find((candidate) => candidate.id === moduleId) || null
        setModule(match)
        const collection = match?.portable?.surfaces.find((candidate): candidate is PortableCollectionSurface => candidate.kind === 'collection') || null
        setSurface(collection)
        if (!match?.enabled || !collection) setMode('settings')
        if (!match) setError('This extension is no longer installed.')
        else if (!collection && !match.portable?.settings) setError('This extension does not publish a portable surface.')
      }).catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : 'Could not load the extension')
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load the extension')
    }
    return () => {
      current = false
    }
  }, [backendId, moduleId, serviceUrl])

  return <SafeAreaView style={styles.safe}>
    <Stack.Screen options={{ title: module?.name || moduleId || 'Extension' }} />
    {error ? <MobileExtensionState title="Extension unavailable" text={error} />
      : module && serviceUrl && backendId && (surface || module.portable?.settings) ? <>
        {surface && module.portable?.settings && <MobileExtensionTabs mode={mode} onChange={setMode} />}
        {mode === 'settings' && module.portable?.settings
          ? <PortableSettingsScreen backendId={backendId} module={module} serviceUrl={serviceUrl} settings={module.portable.settings} />
          : surface && module.enabled
            ? <PortableCollectionScreen backendId={backendId} module={module} serviceUrl={serviceUrl} surface={surface} />
            : module.portable?.settings
              ? <PortableSettingsScreen backendId={backendId} module={module} serviceUrl={serviceUrl} settings={module.portable.settings} />
              : null}
      </>
        : <MobileExtensionState loading text="Loading extension contract…" />}
  </SafeAreaView>
}

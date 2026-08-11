import { useEffect, useRef, useState } from 'react'
import { router } from 'expo-router'
import * as Linking from 'expo-linking'
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { redeemMobilePairLink } from '@/mobile-pairing'
import { colors } from '@/theme'

type PairingState = { kind: 'pairing' | 'error'; message: string }

function pairingUrlToAttempt(url: string | null, attempted: Set<string>): string | null {
  if (!url || attempted.has(url)) return null
  attempted.add(url)
  return url
}

function pairingFailure(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'This pair link could not be used'
}

async function redeemPairingUrl(url: string, onSuccess: () => void, onError: (message: string) => void): Promise<void> {
  try {
    await redeemMobilePairLink(url)
    onSuccess()
  } catch (reason) {
    onError(pairingFailure(reason))
  }
}

function PairingResult({ state }: { state: PairingState }) {
  if (state.kind === 'error') {
    return (
      <>
        <Text style={styles.title}>Pairing did not complete</Text>
        <Text accessibilityRole="alert" style={styles.error}>{state.message}</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.buttonText}>Back to connection setup</Text>
        </Pressable>
      </>
    )
  }
  return (
    <>
      <Text style={styles.title}>Connecting to VertexADE Desktop</Text>
      <Text style={styles.detail}>{state.message}</Text>
    </>
  )
}

export default function PairScreen() {
  const [state, setState] = useState<PairingState>({ kind: 'pairing', message: 'Securing your desktop connection…' })
  const attempted = useRef(new Set<string>())
  const url = Linking.useURL()

  useEffect(() => {
    let mounted = true
    const pairingUrl = pairingUrlToAttempt(url, attempted.current)
    if (pairingUrl) {
      void redeemPairingUrl(
        pairingUrl,
        () => {
          if (mounted) router.replace('/')
        },
        (message) => {
          if (mounted) setState({ kind: 'error', message })
        },
      )
    }
    return () => {
      mounted = false
    }
  }, [url])

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>SECURE PAIRING</Text>
        <PairingResult state={state} />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, justifyContent: 'center', backgroundColor: colors.background, padding: 20 },
  card: { gap: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface, padding: 22 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700', lineHeight: 30 },
  detail: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 15, lineHeight: 22 },
  button: { alignItems: 'center', borderRadius: 12, backgroundColor: colors.accent, padding: 14 },
  buttonText: { color: colors.ink, fontWeight: '700' },
})

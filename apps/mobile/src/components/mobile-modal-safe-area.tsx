import { useEffect, useState, type ComponentProps } from 'react'
import { Keyboard, Platform, StyleSheet } from 'react-native'
import { SafeAreaProvider, SafeAreaView, type Edge, type EdgeMode, type Edges } from 'react-native-safe-area-context'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'

const modalEdges: Edge[] = ['top', 'right', 'bottom', 'left']

export function MobileModalSafeArea(props: ComponentProps<typeof SafeAreaView>) {
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const requestedEdges = props.edges ?? modalEdges
  const visibleEdges = keyboardVisible ? withoutBottomEdge(requestedEdges) : requestedEdges
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return (
    <SafeAreaProvider>
      <KeyboardAvoidingView automaticOffset behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoiding}>
        <SafeAreaView {...props} edges={visibleEdges} />
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  )
}

function withoutBottomEdge(edges: Edges): Edges {
  if (Array.isArray(edges)) return (edges as readonly Edge[]).filter((edge) => edge !== 'bottom')
  const { bottom: _bottom, ...remaining } = edges as Readonly<Partial<Record<Edge, EdgeMode>>>
  return remaining
}

const styles = StyleSheet.create({
  keyboardAvoiding: { backgroundColor: '#000000', flex: 1 },
})

import type { ComponentProps, ReactNode } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
  type GlassStyle,
} from 'expo-glass-effect'

type MobileGlassProps = Omit<ComponentProps<typeof View>, 'style'> & {
  children: ReactNode
  interactive?: boolean
  style?: StyleProp<ViewStyle>
  tintColor?: string
  variant?: GlassStyle
}

const nativeGlassAvailable = Platform.OS === 'ios'
  && isGlassEffectAPIAvailable()
  && isLiquidGlassAvailable()

export function MobileGlass({ children, interactive = false, style, tintColor, variant = 'regular', ...props }: MobileGlassProps) {
  if (!nativeGlassAvailable) return <View {...props} style={[styles.fallback, tintColor ? { backgroundColor: tintColor } : null, style]}>{children}</View>

  return <GlassView
    {...props}
    colorScheme="dark"
    glassEffectStyle={variant}
    isInteractive={interactive}
    style={style}
    tintColor={tintColor}
  >
    {children}
  </GlassView>
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: 'rgba(24, 26, 32, 0.94)' },
})

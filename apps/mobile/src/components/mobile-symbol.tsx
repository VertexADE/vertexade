import { SymbolView, type SFSymbol } from 'expo-symbols'
import { Text } from 'react-native'

export function MobileSymbol({ name, fallback, color, size = 20 }: {
  name: SFSymbol
  fallback: string
  color: string
  size?: number
}) {
  return <SymbolView
    name={name}
    fallback={<Text style={{ color, fontSize: size }}>{fallback}</Text>}
    resizeMode="scaleAspectFit"
    size={size}
    tintColor={color}
    weight="semibold"
  />
}

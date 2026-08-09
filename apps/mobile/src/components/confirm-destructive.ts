import { Alert } from 'react-native'

export function confirmDestructive(title: string, description: string, label: string) {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    Alert.alert(
      title,
      description,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => finish(false) },
        { text: label, style: 'destructive', onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: () => finish(false) },
    )
  })
}

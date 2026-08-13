import { ASRManager } from '@fluidinference/react-native-fluidaudio'
import { Platform } from 'react-native'

let warmup: Promise<void> | null = null

export function warmMobileVoiceModel(): Promise<void> {
  if (Platform.OS !== 'ios') return Promise.resolve()
  if (!warmup) {
    const manager = new ASRManager()
    warmup = manager.initialize().then(() => undefined).catch((reason) => {
      warmup = null
      throw reason
    })
  }
  return warmup
}

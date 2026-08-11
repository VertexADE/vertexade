import { Linking } from 'react-native'

export type MobileLinkErrorHandler = (message: string) => void

export async function openMobileHttpUrl(value: string, onError: MobileLinkErrorHandler): Promise<void> {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS links can be opened')
    await Linking.openURL(url.toString())
  } catch (reason) {
    onError(reason instanceof Error ? reason.message : 'Could not open this link')
  }
}

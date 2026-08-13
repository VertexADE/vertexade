import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { createMobilePlatformClient } from './platform-service'

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
})

export async function registerMobileNotifications(serviceUrls: string[]): Promise<void> {
  if (!Device.isDevice) return
  const existing = await Notifications.getPermissionsAsync()
  const permission = existing.status === 'granted' ? existing : await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } })
  if (permission.status !== 'granted') return
  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId
  if (!projectId) return
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
  await Promise.allSettled(serviceUrls.map((serviceUrl) => createMobilePlatformClient(serviceUrl).request('/api/notifications/push-tokens', {
    method: 'POST',
    body: JSON.stringify({ token, platform: Platform.OS }),
  })))
}

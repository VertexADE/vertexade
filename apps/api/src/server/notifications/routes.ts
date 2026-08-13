import { HttpError } from '@vertexade/platform-server/http'
import { HttpRouter } from '@vertexade/platform-server/router'
import type { NotificationService } from './service.ts'

export function createNotificationRoutes(notifications: NotificationService) {
  return new HttpRouter()
    .get('/api/notifications', () => Response.json(notifications.list()))
    .post('/api/notifications/read', () => {
      notifications.markAllRead()
      return Response.json({ read: true })
    })
    .post('/api/notifications/push-tokens', async (request) => {
      const body = (await request.json()) as { token?: unknown; platform?: unknown }
      const token = String(body.token || '')
      if (!/^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(token)) throw new HttpError('Invalid Expo push token', 400)
      notifications.registerPushToken(token, String(body.platform || 'unknown').slice(0, 20))
      return Response.json({ registered: true })
    })
    .delete('/api/notifications/push-tokens', async (request) => {
      const body = (await request.json()) as { token?: unknown }
      notifications.removePushToken(String(body.token || ''))
      return Response.json({ removed: true })
    })
    .delete('/api/notifications/:notificationId', (_request, { params }) => {
      const id = Number(params.notificationId)
      if (!Number.isInteger(id) || id < 1 || !notifications.dismiss(id)) throw new HttpError('Notification not found', 404)
      return Response.json({ dismissed: id })
    })
    .delete('/api/notifications', () => Response.json({ pruned: notifications.prune() }))
}

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase, type DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { NotificationService } from './service.ts'
import { createNotificationRoutes } from './routes.ts'
import { WorkService } from '../work/service.ts'

const databases: DrizzleDashboardDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('notification domain', () => {
  it('creates, reads, marks, and removes notifications through typed routes', async () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    new WorkService(database).initialize()
    const notify = vi.fn()
    const service = new NotificationService(database, notify)
    const routes = createNotificationRoutes(service)
    const id = service.create('completed', 'Finished', 'Agent completed')

    const listed = await routes.dispatch(new Request('http://localhost/api/notifications'), {})
    await expect(listed?.json()).resolves.toMatchObject({
      unread_count: 1,
      notifications: [{ id, title: 'Finished' }],
    })
    await routes.dispatch(new Request('http://localhost/api/notifications/read', { method: 'POST' }), {})
    expect(service.list().unread_count).toBe(0)
    const dismissed = await routes.dispatch(new Request(`http://localhost/api/notifications/${id}`, { method: 'DELETE' }), {})
    expect(dismissed?.status).toBe(200)
    expect(notify).toHaveBeenCalledWith('notification_dismissed', id)
  })

  it('registers and removes Expo push tokens through the public routes', async () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    new WorkService(database).initialize()
    const routes = createNotificationRoutes(new NotificationService(database, vi.fn()))
    const token = 'ExponentPushToken[device_token]'

    const registered = await routes.dispatch(
      new Request('http://localhost/api/notifications/push-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, platform: 'ios' }),
      }),
      {},
    )
    expect(registered?.status).toBe(200)
    expect(database.get<{ token: string }>(`SELECT token FROM mobile_push_tokens WHERE token = '${token}'`)?.token).toBe(token)

    const removed = await routes.dispatch(
      new Request('http://localhost/api/notifications/push-tokens', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
      {},
    )
    expect(removed?.status).toBe(200)
    expect(database.get(`SELECT token FROM mobile_push_tokens WHERE token = '${token}'`)).toBeUndefined()
  })
})

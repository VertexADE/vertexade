import { describe, expect, it, vi } from 'vite-plus/test'
import { AZURE_WEBHOOK_USERNAME, handleAzureWebhook, normalizeAzureWebhook } from './webhook.ts'

const secret = 'azure-webhook-secret'

function request(payload: Record<string, unknown>, password = secret) {
  return new Request('http://localhost/api/extensions/azure-devops/webhook', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${AZURE_WEBHOOK_USERNAME}:${password}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

function dependencies() {
  return {
    config: () => ({ project: 'Delivery', webhookSecret: secret }),
    onChange: vi.fn(),
  }
}

describe('Azure DevOps webhook adapter', () => {
  it('normalizes supported work-item events from the configured project', () => {
    expect(
      normalizeAzureWebhook(
        {
          id: 'delivery-1',
          eventType: 'workitem.updated',
          resource: {
            workItemId: 42,
            revision: { fields: { 'System.TeamProject': 'Delivery' } },
          },
        },
        'Delivery',
      ),
    ).toEqual({
      reason: 'azure_work_item_updated',
      workItemId: '42',
      deliveryId: 'delivery-1',
    })
  })

  it('ignores other projects and non-board events', () => {
    expect(
      normalizeAzureWebhook(
        {
          eventType: 'workitem.updated',
          resource: { fields: { 'System.TeamProject': 'Other' } },
        },
        'Delivery',
      ),
    ).toBeNull()
    expect(normalizeAzureWebhook({ eventType: 'workitem.commented' }, 'Delivery')).toBeNull()
  })

  it('authenticates, invalidates, and emits only supported changes', async () => {
    const effects = dependencies()
    const response = await handleAzureWebhook(
      request({
        eventType: 'workitem.created',
        resource: { id: 7, fields: { 'System.TeamProject': 'Delivery' } },
      }),
      effects,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ accepted: true, refreshed: true })
    expect(effects.onChange).toHaveBeenCalledWith('azure_work_item_created')

    const ignored = await handleAzureWebhook(request({ eventType: 'build.complete' }), effects)
    await expect(ignored.json()).resolves.toEqual({ accepted: true, refreshed: false })
    expect(effects.onChange).toHaveBeenCalledOnce()
  })

  it('rejects invalid credentials before producing side effects', async () => {
    const effects = dependencies()
    await expect(
      handleAzureWebhook(
        request(
          {
            eventType: 'workitem.updated',
            resource: { id: 7 },
          },
          'wrong-secret',
        ),
        effects,
      ),
    ).rejects.toEqual(expect.objectContaining({ status: 401 }))
    expect(effects.onChange).not.toHaveBeenCalled()
  })
})

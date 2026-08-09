import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vite-plus/test'
import { handleAirtableWebhook, matchesAirtableWebhook } from './webhook.ts'

const secret = Buffer.from('airtable-mac-secret')
const registration = {
  id: 'ach-webhook-1',
  macSecretBase64: secret.toString('base64'),
  publicUrl: 'https://vertexade.example',
  notificationUrl: 'https://vertexade.example/api/extensions/airtable/webhook',
  expirationTime: null,
}

function request(payload: Record<string, unknown>, signingSecret = secret) {
  const body = JSON.stringify(payload)
  return new Request(registration.notificationUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-airtable-content-mac': `hmac-sha256=${createHmac('sha256', signingSecret).update(body).digest('hex')}`,
    },
    body,
  })
}

function dependencies() {
  return {
    config: () => ({ baseId: 'app-base-1', webhook: registration }),
    onChange: vi.fn(),
  }
}

describe('Airtable webhook adapter', () => {
  it('matches only the configured base and webhook registration', () => {
    expect(
      matchesAirtableWebhook(
        {
          base: { id: 'app-base-1' },
          webhook: { id: 'ach-webhook-1' },
        },
        'app-base-1',
        'ach-webhook-1',
      ),
    ).toBe(true)
    expect(
      matchesAirtableWebhook(
        {
          base: { id: 'other-base' },
          webhook: { id: 'ach-webhook-1' },
        },
        'app-base-1',
        'ach-webhook-1',
      ),
    ).toBe(false)
  })

  it('verifies the MAC and refreshes only the Airtable board', async () => {
    const effects = dependencies()
    const response = await handleAirtableWebhook(
      request({
        base: { id: 'app-base-1' },
        webhook: { id: 'ach-webhook-1' },
        timestamp: '2026-07-28T12:00:00.000Z',
      }),
      effects,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ accepted: true, refreshed: true })
    expect(effects.onChange).toHaveBeenCalledWith('airtable_records_changed')
  })

  it('acknowledges a valid but unrelated registration without refreshing', async () => {
    const effects = dependencies()
    const response = await handleAirtableWebhook(
      request({
        base: { id: 'app-base-1' },
        webhook: { id: 'other-webhook' },
      }),
      effects,
    )

    await expect(response.json()).resolves.toEqual({ accepted: true, refreshed: false })
    expect(effects.onChange).not.toHaveBeenCalled()
  })

  it('rejects invalid MACs before producing side effects', async () => {
    const effects = dependencies()
    await expect(
      handleAirtableWebhook(
        request(
          {
            base: { id: 'app-base-1' },
            webhook: { id: 'ach-webhook-1' },
          },
          Buffer.from('wrong-secret'),
        ),
        effects,
      ),
    ).rejects.toEqual(expect.objectContaining({ status: 401 }))
    expect(effects.onChange).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vite-plus/test'
import { deleteAirtableSettings, saveAirtableSettings } from './config.ts'
import type { AirtableConfig } from './types.ts'

function settingsHost(initial: AirtableConfig) {
  let stored = initial
  const settings = {
    read: vi.fn(() => stored),
    write: vi.fn((_key: string, value: AirtableConfig) => {
      stored = value
    }),
    delete: vi.fn(),
  }
  const events = { emit: vi.fn() }
  return {
    host: {
      settings,
      events,
      cache: { invalidate: vi.fn(() => 1) },
    },
    settings,
    events,
    stored: () => stored,
  }
}

function config(webhook: AirtableConfig['webhook'] = null): AirtableConfig {
  return {
    token: 'pat',
    baseId: 'app',
    tableId: 'work',
    view: '',
    titleField: 'Title',
    cardFields: [],
    webhook,
  }
}

function settingsRequest(input: Record<string, unknown>) {
  return new Request('http://localhost/api/extensions/airtable/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      base_id: 'app',
      table_id: 'work',
      title_field: 'Title',
      ...input,
    }),
  })
}

describe('Airtable managed webhook Effect workflow', () => {
  it('creates and persists live synchronization before publishing the change', async () => {
    const state = settingsHost(config())
    const createWebhook = vi.fn(async () => ({
      id: 'ach-new',
      macSecretBase64: 'c2VjcmV0',
      expirationTime: '2026-08-05T00:00:00.000Z',
    }))
    const deleteWebhook = vi.fn()
    const provider = {
      createClient: vi.fn(() => ({ createWebhook, deleteWebhook })),
    }

    const response = await saveAirtableSettings(
      settingsRequest({
        live_sync: true,
        public_url: 'https://vertexade.example',
      }),
      provider as never,
      state.host as never,
    )

    expect(response.status).toBe(200)
    expect(state.stored().webhook).toMatchObject({
      id: 'ach-new',
      publicUrl: 'https://vertexade.example',
      notificationUrl: 'https://vertexade.example/api/extensions/airtable/webhook',
    })
    expect(deleteWebhook).not.toHaveBeenCalled()
    expect(state.events.emit).toHaveBeenCalledWith('airtable_settings_updated', undefined)
  })

  it('rolls back a replacement when the previous webhook cannot be removed', async () => {
    const state = settingsHost(
      config({
        id: 'ach-old',
        macSecretBase64: 'b2xkLXNlY3JldA==',
        publicUrl: 'https://old.example',
        notificationUrl: 'https://old.example/api/extensions/airtable/webhook',
        expirationTime: null,
      }),
    )
    const createWebhook = vi.fn(async () => ({
      id: 'ach-new',
      macSecretBase64: 'bmV3LXNlY3JldA==',
    }))
    const deleteWebhook = vi.fn(async (id: string) => {
      if (id === 'ach-old') throw new Error('Old webhook could not be removed')
    })
    const provider = {
      createClient: vi.fn(() => ({ createWebhook, deleteWebhook })),
    }

    await expect(
      saveAirtableSettings(
        settingsRequest({
          live_sync: true,
          public_url: 'https://new.example',
        }),
        provider as never,
        state.host as never,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Old webhook could not be removed',
    })

    expect(deleteWebhook.mock.calls.map(([id]) => id)).toEqual(['ach-old', 'ach-new'])
    expect(state.settings.write).not.toHaveBeenCalled()
  })

  it('reports upstream removal failures without deleting local settings', async () => {
    const state = settingsHost(
      config({
        id: 'ach-old',
        macSecretBase64: 'b2xkLXNlY3JldA==',
        publicUrl: 'https://vertexade.example',
        notificationUrl: 'https://vertexade.example/api/extensions/airtable/webhook',
        expirationTime: null,
      }),
    )
    const provider = {
      createClient: vi.fn(() => ({
        deleteWebhook: vi.fn(async () => {
          throw new Error('Airtable is unavailable')
        }),
      })),
    }

    await expect(deleteAirtableSettings(provider as never, state.host as never)).rejects.toMatchObject({
      status: 502,
      message: 'Airtable is unavailable',
    })
    expect(state.settings.delete).not.toHaveBeenCalled()
  })
})

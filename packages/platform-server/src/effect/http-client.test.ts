import { describe, expect, it, vi } from 'vite-plus/test'
import { resilientFetch } from './http-client.ts'

describe('resilient Effect fetch', () => {
  it('retries idempotent requests after transient failures', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(Response.json({ ok: true }))

    const response = await resilientFetch({
      service: 'Airtable',
      fetch,
      url: 'https://api.airtable.test/records',
      retryDelayMs: () => 0,
    })

    expect(response.ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not repeat a non-idempotent write after an ambiguous failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('connection reset'))

    await expect(
      resilientFetch({
        service: 'Airtable',
        fetch,
        url: 'https://api.airtable.test/records',
        init: { method: 'POST' },
        retryDelayMs: () => 0,
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: 'Airtable request failed: connection reset',
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('returns the final upstream response for service-specific parsing', async () => {
    const response = new Response('gateway unavailable', { status: 502 })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)

    await expect(
      resilientFetch({
        service: 'Azure DevOps',
        fetch,
        url: 'https://dev.azure.test/items',
        attempts: 1,
      }),
    ).resolves.toBe(response)
  })
})

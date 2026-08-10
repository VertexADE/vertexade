import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { azureConfig } from './client.ts'
import { proxyAzureAvatar } from './avatar.ts'

afterEach(() => vi.unstubAllGlobals())

const config = azureConfig({ url: 'https://dev.azure.com/acme', project: 'Portal', pat: 'secret' })
const request = new Request(
  'http://localhost/api/extensions/azure-devops/avatar?url=https%3A%2F%2Fdev.azure.com%2F_apis%2FGraphProfile%2FMemberAvatars%2Fada',
)

describe('Azure avatar proxy', () => {
  it('rejects non-image content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })),
    )
    await expect(proxyAzureAvatar(request, config)).rejects.toThrow('unsupported content type')
  })

  it('rejects oversized images before buffering their bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('image', {
            headers: { 'content-length': String(2 * 1024 * 1024 + 1), 'content-type': 'image/png' },
          }),
      ),
    )
    await expect(proxyAzureAvatar(request, config)).rejects.toThrow('Azure avatar is too large')
  })
})

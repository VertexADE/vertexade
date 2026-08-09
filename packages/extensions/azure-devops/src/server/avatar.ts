import { HttpError } from '@vertexade/platform-server/http'
import { resilientFetch } from '@vertexade/platform-server/effect'
import type { AzureConfig } from './client.ts'

export async function proxyAzureAvatar(request: Request, config: AzureConfig) {
  let avatarUrl: URL
  try {
    avatarUrl = new URL(String(new URL(request.url).searchParams.get('url') || ''))
  } catch {
    throw new HttpError('Invalid avatar URL', 400)
  }

  const organizationUrl = new URL(config.url)
  const isAzureAvatar =
    avatarUrl.protocol === 'https:' &&
    avatarUrl.hostname === organizationUrl.hostname &&
    avatarUrl.pathname.includes('/_apis/GraphProfile/MemberAvatars/')
  if (!isAzureAvatar) throw new HttpError('Invalid Azure avatar URL', 400)

  const response = await resilientFetch({
    service: 'Azure DevOps avatar',
    fetch: globalThis.fetch,
    url: avatarUrl.toString(),
    init: {
      headers: {
        authorization: `Basic ${Buffer.from(`:${config.pat}`).toString('base64')}`,
      },
    },
    timeoutMs: 15_000,
  })
  if (!response.ok) {
    throw new HttpError('Azure avatar could not be loaded', response.status)
  }
  return new Response(await response.arrayBuffer(), {
    headers: {
      'content-type': response.headers.get('content-type') || 'image/png',
      'cache-control': 'private, max-age=3600',
    },
  })
}

import { createSign } from 'node:crypto'
import { isRecord, parseJsonResponse, requestSignal } from '@vertexade/platform-server/http'
import { resilientFetch } from '@vertexade/platform-server/effect'

export type GitHubAppCredentials = {
  appId: string
  installationId: string
  privateKey: string
}

export type GitHubInstallationToken = {
  token: string
  expiresAt: string
}

type GitHubTokenRequestOptions = {
  signal?: AbortSignal | null
  timeoutMs?: number
  maxResponseBytes?: number
}

const GITHUB_TOKEN_RESPONSE_BYTES = 64 * 1024

function encoded(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function createGitHubAppJwt(credentials: GitHubAppCredentials, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000) - 60
  const unsigned = `${encoded({ alg: 'RS256', typ: 'JWT' })}.${encoded({ iat: issuedAt, exp: issuedAt + 600, iss: credentials.appId })}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(credentials.privateKey, 'base64url')
  return `${unsigned}.${signature}`
}

export async function createGitHubInstallationToken(
  credentials: GitHubAppCredentials,
  fetchImpl: typeof fetch = fetch,
  options: GitHubTokenRequestOptions = {},
): Promise<GitHubInstallationToken> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const signal = requestSignal(options.signal, timeoutMs)
  try {
    const response = await resilientFetch({
      service: 'GitHub App authentication',
      fetch: fetchImpl,
      url: `https://api.github.com/app/installations/${encodeURIComponent(credentials.installationId)}/access_tokens`,
      init: {
        method: 'POST',
        signal,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${createGitHubAppJwt(credentials)}`,
          'user-agent': 'vertexade',
          'x-github-api-version': '2022-11-28',
        },
      },
      timeoutMs,
      attempts: 1,
    })
    const data = await parseJsonResponse(
      response,
      'GitHub App authentication',
      options.maxResponseBytes ?? GITHUB_TOKEN_RESPONSE_BYTES,
      signal,
    )
    if (!isRecord(data) || typeof data.token !== 'string' || typeof data.expires_at !== 'string')
      throw new Error('GitHub App authentication returned an invalid token response')
    return { token: data.token, expiresAt: data.expires_at }
  } catch (error) {
    if (signal.aborted) {
      const cancelled = options.signal?.aborted
      throw new Error(`GitHub App authentication ${cancelled ? 'was cancelled' : 'timed out'}`, { cause: error })
    }
    throw error
  }
}

import { readRequestBody, readResponseBody } from '@vertexade/platform-server/http'
import { OutboundRequestPolicy } from '@vertexade/platform-server/outbound-policy'
import { parseBrowserPairLink } from './browser-pairing'
import {
  browserCredentialCookie,
  browserCredentialId,
  clearBrowserCredentialCookie,
  localBrowserSessionCookie,
} from './browser-pairing-session'
import { recordError, requestPairedServers } from './api-proxy-request-validation'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function pairingJson(response: Response, signal: AbortSignal) {
  const raw = (await readResponseBody(response, 64 * 1024, signal)).toString('utf8')
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error('Pairing redemption returned invalid JSON')
  }
}

export async function redeemBrowserPairing(request: Request, localUrls: Set<string>, namespace: number) {
  let input: Record<string, unknown>
  try {
    input = JSON.parse((await readRequestBody(request.clone(), 16 * 1024)).toString('utf8')) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Pairing request is invalid' }, { status: 400 })
  }
  let pairing: ReturnType<typeof parseBrowserPairLink>
  try {
    pairing = parseBrowserPairLink(String(input.pairUrl || ''))
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 })
  }
  const policy = new OutboundRequestPolicy({ allowedOrigins: [pairing.serviceUrl] })
  try {
    const response = await policy.fetch(new URL('/api/mobile-pairing/redeem', pairing.serviceUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: pairing.token, deviceName: String(input.deviceName || 'VertexADE Web') }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
    })
    const payload = await pairingJson(response, request.signal).catch(() => null)
    if (!response.ok)
      return Response.json(recordError(payload) || { error: `Pairing failed with HTTP ${response.status}` }, { status: response.status })
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      return Response.json({ error: 'Invalid pairing response' }, { status: 502 })
    const redemption = payload as Record<string, unknown>
    if (
      String(redemption.serviceUrl || '').replace(/\/$/, '') !== pairing.serviceUrl ||
      !String(redemption.sessionToken || '').trim() ||
      Date.parse(String(redemption.expiresAt || '')) <= Date.now()
    )
      return Response.json({ error: 'Invalid pairing response' }, { status: 502 })
    const headers = new Headers()
    const credentialId = browserCredentialId(pairing.serviceUrl)
    headers.append(
      'set-cookie',
      browserCredentialCookie(request, credentialId, String(redemption.sessionToken), String(redemption.expiresAt)),
    )
    if (localUrls.has(pairing.serviceUrl)) headers.append('set-cookie', localBrowserSessionCookie(request, String(redemption.sessionToken)))
    const { sessionToken: _sessionToken, ...publicRedemption } = redemption
    return Response.json({ ...publicRedemption, credentialId, namespace }, { status: 201, headers })
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 502 })
  } finally {
    await policy.dispose()
  }
}

export function revokeBrowserCredential(request: Request) {
  const credentialId = String(new URL(request.url).searchParams.get('id') || '')
  if (!/^[a-f0-9]{24}$/.test(credentialId)) return Response.json({ error: 'Invalid browser credential' }, { status: 400 })
  return Response.json({ revoked: true }, { headers: { 'set-cookie': clearBrowserCredentialCookie(request, credentialId) } })
}

export function migrateBrowserPairings(request: Request) {
  const legacy = requestPairedServers(request).filter((server) => server.sessionToken)
  const headers = new Headers()
  const credentials = legacy.map((server) => {
    const credentialId = browserCredentialId(server.serviceUrl)
    headers.append('set-cookie', browserCredentialCookie(request, credentialId, server.sessionToken!, server.expiresAt))
    return { serviceUrl: server.serviceUrl, credentialId }
  })
  return Response.json({ credentials }, { headers })
}

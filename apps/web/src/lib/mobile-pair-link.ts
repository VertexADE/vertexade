const pairingTokenPattern = /^[A-Z0-9]{32}$/

export function pairingTokenFromHash(hash: string): string | null {
  const parameters = new URLSearchParams(hash.replace(/^#/, ''))
  const token = String(parameters.get('token') || '')
    .trim()
    .toUpperCase()
  return pairingTokenPattern.test(token) ? token : null
}

export function mobilePairingDeepLink(origin: string, token: string): string {
  const parameters = new URLSearchParams({ origin: new URL(origin).origin, token })
  return `vertexade://pair#${parameters.toString()}`
}

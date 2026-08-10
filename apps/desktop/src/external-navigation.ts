export type ExternalNavigationDecision = 'internal' | 'external' | 'blocked'

export function externalNavigationDecision(target: string, applicationOrigin: string): ExternalNavigationDecision {
  try {
    const url = new URL(target)
    if (url.origin === applicationOrigin) return 'internal'
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return 'external'
    return 'blocked'
  } catch {
    return 'blocked'
  }
}

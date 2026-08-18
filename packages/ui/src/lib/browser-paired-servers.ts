export const browserPairedServersStorageKey = 'vertexade.web.paired-servers.v1'
export const browserPairedServersHeaderName = 'x-vertexade-paired-servers'

function storedBrowserPairedServers(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(browserPairedServersStorageKey)
  } catch {
    return null
  }
}

export function browserPairedServersRequestHeaders(): Record<string, string> {
  const catalog = storedBrowserPairedServers()
  return catalog ? { [browserPairedServersHeaderName]: encodeURIComponent(catalog) } : {}
}

export function hasBrowserPairedServers() {
  const catalog = storedBrowserPairedServers()
  if (!catalog) return false
  try {
    const value = JSON.parse(catalog) as unknown
    return Array.isArray(value) && value.length > 0
  } catch {
    return false
  }
}

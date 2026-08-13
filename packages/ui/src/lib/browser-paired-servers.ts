export const browserPairedServersStorageKey = 'vertexade.web.paired-servers.v1'
export const browserPairedServersHeaderName = 'x-vertexade-paired-servers'

export function browserPairedServersRequestHeaders(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  const catalog = localStorage.getItem(browserPairedServersStorageKey)
  return catalog ? { [browserPairedServersHeaderName]: encodeURIComponent(catalog) } : {}
}

export type PlatformQueryKey = readonly ['platform', string, string]

export function platformQueryKey(resource: string, backendId = 'federated'): PlatformQueryKey {
  return ['platform', backendId, resource]
}

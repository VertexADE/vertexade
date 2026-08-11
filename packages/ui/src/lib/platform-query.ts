import { activeBackendId } from '@vertexade/ui/lib/backend-registry'

export type PlatformQueryKey = readonly ['platform', string, string]

export function platformQueryKey(resource: string, backendId: string = activeBackendId() || 'primary'): PlatformQueryKey {
  return ['platform', backendId, resource]
}

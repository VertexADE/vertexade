import type { CapabilitySchema, CapabilityValue } from '@vertexade/platform-contracts'
import { createTrigger } from '@vertexade/platform-extension-sdk'

export type CacheRefreshTrigger = ReturnType<typeof createCacheRefreshTrigger>

export function createCacheRefreshTrigger({
  id,
  name,
  description,
  resource,
  properties = {},
}: {
  id: string
  name: string
  description: string
  resource: string
  properties?: Record<string, CapabilitySchema>
}) {
  const controller = createTrigger({
    id,
    name,
    description,
    outputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', title: 'Refresh type', enum: ['refresh', 'force-refresh'] },
        resource: { type: 'string', title: 'Resource', enum: [resource] },
        provider: { type: 'string', title: 'Provider' },
        key: { type: 'string', title: 'Cache key' },
        ...properties,
      },
      required: ['reason', 'resource', 'provider', 'key'],
      additionalProperties: true,
    },
  })
  return {
    ...controller,
    emitRefresh({
      force,
      provider,
      key,
      subject,
      data = {},
    }: {
      force: boolean
      provider: string
      key: string
      subject?: string
      data?: Record<string, CapabilityValue>
    }) {
      return controller.emit({
        ...(subject ? { subject } : {}),
        data: { reason: force ? 'force-refresh' : 'refresh', resource, provider, key, ...data },
      })
    },
  }
}

import type { ExtensionCacheOptions, ExtensionCacheMetadata, ExtensionHostServices } from '@vertexade/platform-contracts'
import { type ApiEffect, runApiEffect, tryApiPromise } from './effect/index.ts'

const BOARD_CACHE_TTL_MS = 30_000
const BOARD_CACHE_STALE_WHILE_REVALIDATE_MS = 120_000
const BOARD_CACHE_TAGS = ['board', 'references']

type ExtensionDataHost = Pick<ExtensionHostServices, 'cache' | 'events'>
type ExtensionDataResult<T> = {
  value: T
  cache: ExtensionCacheMetadata | undefined
}

export function extensionDataCacheOptions(forceRefresh = false): ExtensionCacheOptions {
  return {
    ttlMs: BOARD_CACHE_TTL_MS,
    staleWhileRevalidateMs: BOARD_CACHE_STALE_WHILE_REVALIDATE_MS,
    tags: [...BOARD_CACHE_TAGS],
    forceRefresh,
  }
}

export function loadExtensionDataEffect<T>(
  host: Pick<ExtensionHostServices, 'cache'>,
  key: string,
  loader: () => Promise<T>,
  forceRefresh = false,
): ApiEffect<ExtensionDataResult<T>> {
  return tryApiPromise(
    async () => {
      if (host.cache) {
        return host.cache.getOrLoad(key, loader, extensionDataCacheOptions(forceRefresh))
      }
      return {
        value: await loader(),
        cache: undefined,
      }
    },
    {
      kind: 'upstream',
      message: 'Extension data could not be loaded',
      status: 502,
      code: 'EXTENSION_DATA_LOAD_FAILED',
    },
  )
}

export function loadExtensionData<T>(
  host: Pick<ExtensionHostServices, 'cache'>,
  key: string,
  loader: () => Promise<T>,
  forceRefresh = false,
): Promise<ExtensionDataResult<T>> {
  return runApiEffect(loadExtensionDataEffect(host, key, loader, forceRefresh))
}

export function invalidateExtensionData(host: Pick<ExtensionHostServices, 'cache'>) {
  return host.cache?.invalidate({ tags: [...BOARD_CACHE_TAGS] }) ?? 0
}

export function publishExtensionChange(host: ExtensionDataHost, reason: string, entityId?: number | null) {
  invalidateExtensionData(host)
  host.events.emit(reason, entityId)
}

import { BoundedTtlCache, jsonByteSize } from '@vertexade/platform-server/bounded-cache'

export const PR_DETAILS_CACHE_MAX_ENTRIES = 32
export const PR_DETAILS_CACHE_MAX_BYTES = 32 * 1024 * 1024

export function createPullRequestDetailsCache() {
  return new BoundedTtlCache<string, any>({
    maxEntries: PR_DETAILS_CACHE_MAX_ENTRIES,
    maxBytes: PR_DETAILS_CACHE_MAX_BYTES,
    ttlMs: 30_000,
    sizeOf: jsonByteSize,
  })
}

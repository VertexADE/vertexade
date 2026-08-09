import { useCallback, useRef, useState } from 'react'
import type { PortableCollectionSurface } from '@vertexade/platform-contracts'
import { requestPortableSource, resolvePortableSourceValues, type PlatformExtensionClient } from './index'

function currentLoad(signal: AbortSignal | undefined, sequence: number, latest: number) {
  return !signal?.aborted && sequence === latest
}

function loadErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Could not load this extension surface'
}

function updateCurrentLoad(signal: AbortSignal | undefined, sequence: number, latest: number, update: () => void) {
  if (currentLoad(signal, sequence, latest)) update()
}

export function usePortableCollectionSource<T extends Record<string, unknown>>({
  extension,
  surface,
}: {
  extension: PlatformExtensionClient
  surface: PortableCollectionSurface
}) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [sourceValues, setSourceValues] = useState<Record<string, string>>({})
  const loadSequence = useRef(0)

  const load = useCallback(
    async (force = false, signal?: AbortSignal) => {
      const sequence = ++loadSequence.current
      setLoading(true)
      setError('')
      try {
        const next = await requestPortableSource<T>(extension, surface, sourceValues, force, signal)
        updateCurrentLoad(signal, sequence, loadSequence.current, () => {
          setData(next)
          setLastSyncedAt(new Date())
          setSourceValues((current) => resolvePortableSourceValues(surface, current, next))
        })
      } catch (reason) {
        updateCurrentLoad(signal, sequence, loadSequence.current, () => {
          setError(loadErrorMessage(reason))
        })
      } finally {
        updateCurrentLoad(signal, sequence, loadSequence.current, () => {
          setLoading(false)
        })
      }
    },
    [extension, sourceValues, surface],
  )

  return {
    data,
    setData,
    loading,
    error,
    setError,
    lastSyncedAt,
    sourceValues,
    setSourceValues,
    load,
  }
}

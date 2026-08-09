import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PortableCollectionSurface } from '@vertexade/platform-contracts'
import type { PlatformExtensionClient } from '@vertexade/platform-client'
import { readPortablePath, type PortableCollectionItem } from '@vertexade/platform-contracts/portable'
import { toast } from 'sonner'

function currentDetailLoad(sequence: number, latest: number, signal: AbortSignal | undefined) {
  return sequence === latest && signal?.aborted !== true
}

function updateCurrentDetailLoad(sequence: number, latest: number, signal: AbortSignal | undefined, update: () => void) {
  if (currentDetailLoad(sequence, latest, signal)) update()
}

function portableDetailError(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Could not load details'
}

export function portableDetailItem(
  selectedId: string | null,
  boardItem: PortableCollectionItem | null,
  detailData: unknown,
  surface: PortableCollectionSurface,
): PortableCollectionItem | null {
  if (!selectedId) return null
  if (boardItem)
    return detailData && typeof detailData === 'object'
      ? { ...boardItem, raw: { ...boardItem.raw, ...(detailData as Record<string, unknown>) } }
      : boardItem
  if (!detailData || typeof detailData !== 'object') return null
  const raw = detailData as Record<string, unknown>
  return {
    id: selectedId,
    title: String(readPortablePath(raw, surface.detail?.titlePath) || raw.title || `Item #${selectedId}`),
    subtitle: '',
    fields: [],
    raw,
    depth: 0,
  }
}

export function usePortableDetail({
  extension,
  surface,
  selectedId,
  boardItem,
}: {
  extension: PlatformExtensionClient
  surface: PortableCollectionSurface
  selectedId: string | null
  boardItem: PortableCollectionItem | null
}) {
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const sequence = useRef(0)

  const load = useCallback(
    async (itemId: string, signal?: AbortSignal) => {
      const current = ++sequence.current
      setData(null)
      const source = surface.detail?.source
      if (!source) return
      setLoading(true)
      try {
        const result = await extension.request(source.path.replaceAll('{id}', encodeURIComponent(itemId)), { signal })
        updateCurrentDetailLoad(current, sequence.current, signal, () => setData(result))
      } catch (reason) {
        updateCurrentDetailLoad(current, sequence.current, signal, () => toast.error(portableDetailError(reason)))
      } finally {
        updateCurrentDetailLoad(current, sequence.current, signal, () => setLoading(false))
      }
    },
    [extension, surface.detail],
  )

  useEffect(() => {
    if (!selectedId) {
      sequence.current += 1
      setData(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    void load(selectedId, controller.signal)
    return () => controller.abort()
  }, [load, selectedId])

  const detail = useMemo(() => portableDetailItem(selectedId, boardItem, data, surface), [boardItem, data, selectedId, surface])
  const reset = useCallback(() => {
    sequence.current += 1
    setData(null)
    setLoading(false)
  }, [])
  return { detail, detailData: data, detailLoading: loading, reset }
}

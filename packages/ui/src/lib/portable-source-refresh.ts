import { useEffect, useRef } from 'react'
import { PORTABLE_SOURCE_POLL_INTERVAL_MS } from '@vertexade/platform-client'
type PortableSourceLoader = (forceRefresh?: boolean, signal?: AbortSignal) => Promise<void>

export function usePortableSourceRefresh({
  load,
  polling,
  surfaceKey,
}: {
  load: PortableSourceLoader
  polling: boolean
  surfaceKey: string
}) {
  const loadedSurface = useRef('')

  useEffect(() => {
    const forceRefresh = loadedSurface.current !== surfaceKey
    loadedSurface.current = surfaceKey
    const controller = new AbortController()
    void load(forceRefresh, controller.signal)
    return () => controller.abort()
  }, [load, surfaceKey])

  useEffect(() => {
    if (!polling) return
    let stopped = false
    let pollingNow = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    const schedule = () => {
      if (stopped) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void poll(), PORTABLE_SOURCE_POLL_INTERVAL_MS)
    }
    const poll = async () => {
      if (stopped) return
      if (document.visibilityState === 'hidden') {
        schedule()
        return
      }
      pollingNow = true
      controller = new AbortController()
      await load(true, controller.signal)
      pollingNow = false
      schedule()
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible' || pollingNow) return
      if (timer) clearTimeout(timer)
      void poll()
    }

    schedule()
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      stopped = true
      controller?.abort()
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [load, polling])
}

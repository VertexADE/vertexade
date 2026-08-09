import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { PORTABLE_SOURCE_POLL_INTERVAL_MS } from '@vertexade/platform-client'

type PortableSourceLoader = (
  forceRefresh?: boolean,
  signal?: AbortSignal,
) => Promise<void>

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
    let active = AppState.currentState === 'active'
    let pollingNow = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    const schedule = () => {
      if (stopped || !active) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void poll(), PORTABLE_SOURCE_POLL_INTERVAL_MS)
    }
    const poll = async () => {
      if (stopped || !active) return
      pollingNow = true
      controller = new AbortController()
      await load(true, controller.signal)
      pollingNow = false
      schedule()
    }
    const pause = () => {
      active = false
      controller?.abort()
      if (timer) clearTimeout(timer)
    }
    const resume = () => {
      const resumed = !active
      active = true
      if (!resumed || pollingNow) return
      void poll()
    }
    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active') resume()
      else pause()
    }

    schedule()
    const subscription = AppState.addEventListener('change', handleAppState)
    return () => {
      stopped = true
      controller?.abort()
      if (timer) clearTimeout(timer)
      subscription.remove()
    }
  }, [load, polling])
}

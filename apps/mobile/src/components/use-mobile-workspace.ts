import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileBackend } from '@/platform-service'
import {
  loadMobileWorkspace,
  type MobileWorkspace,
} from '@/mobile-workspace-service'

const emptyWorkspace: MobileWorkspace = {
  repositories: [],
  pullRequests: [],
  workItems: [],
  threads: [],
}

export function useMobileWorkspace(serviceUrl: string, backends: MobileBackend[]) {
  const [workspace, setWorkspace] = useState<MobileWorkspace>(emptyWorkspace)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestSequence = useRef(0)

  const refresh = useCallback(async () => {
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    setLoading(true)
    setError('')
    try {
      const next = await loadMobileWorkspace(serviceUrl, backends)
      if (requestSequence.current === sequence) setWorkspace(next)
    } catch (reason) {
      if (requestSequence.current === sequence) {
        setError(reason instanceof Error ? reason.message : 'Could not load the mobile workspace')
      }
    } finally {
      if (requestSequence.current === sequence) setLoading(false)
    }
  }, [backends, serviceUrl])

  useEffect(() => {
    void refresh()
    return () => {
      requestSequence.current += 1
    }
  }, [refresh])

  return {
    workspace,
    loading,
    error,
    notice,
    setNotice,
    refresh,
  }
}

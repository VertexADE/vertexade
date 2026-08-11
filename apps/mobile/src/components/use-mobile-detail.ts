import { useCallback, useEffect, useRef, useState } from 'react'

export function useMobileDetail<Value>(key: string, loader: () => Promise<Value>) {
  const [value, setValue] = useState<Value | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const sequence = useRef(0)

  const refresh = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const request = sequence.current + 1
    sequence.current = request
    if (!silent) setLoading(true)
    setError('')
    try {
      const next = await loader()
      if (sequence.current === request) setValue(next)
    } catch (reason) {
      if (sequence.current === request && !silent)
        setError(reason instanceof Error ? reason.message : 'Could not load details')
    } finally {
      if (sequence.current === request && !silent) setLoading(false)
    }
  }, [loader])

  useEffect(() => {
    setValue(null)
    void refresh()
    return () => {
      sequence.current += 1
    }
  }, [key, refresh])

  return { value, loading, error, refresh }
}

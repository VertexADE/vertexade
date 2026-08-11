import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { auditTime, filter } from 'rxjs'
import { platformEventMessages } from '@vertexade/ui/lib/dashboard-api'
import { platformQueryKey } from '@vertexade/ui/lib/platform-query'

type ReactiveApiOptions<T> = {
  key: string
  load(): Promise<T>
  accepts?: (event: Event) => boolean
  auditMs?: number
}

export function useReactiveApi<T>(options: ReactiveApiOptions<T>) {
  const queryClient = useQueryClient()
  const queryKey = platformQueryKey(options.key)
  const query = useQuery({
    queryKey,
    queryFn: options.load,
    enabled: typeof window !== 'undefined',
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const subscription = platformEventMessages()
      .pipe(
        filter((message) => options.accepts?.(message.raw) ?? true),
        auditTime(options.auditMs ?? 120),
      )
      .subscribe(() => void queryClient.invalidateQueries({ queryKey }))
    return () => subscription.unsubscribe()
  }, [options.accepts, options.auditMs, queryClient, queryKey[1], queryKey[2]])

  const refresh = async (): Promise<T | undefined> => {
    const result = await query.refetch()
    if (result.error) throw result.error
    return result.data
  }

  return {
    data: query.data,
    loading: query.isFetching,
    error: query.error,
    updatedAt: query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : null,
    ready: query.data !== undefined,
    refresh,
  }
}

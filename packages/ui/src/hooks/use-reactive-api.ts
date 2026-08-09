import { useEffect, useState } from 'react'
import { createReactiveQuery, type PlatformEventMessage, type ReactiveQueryState } from '@vertexade/platform-client/reactive'
import { platformEventMessages } from '@vertexade/ui/lib/dashboard-api'

type ReactiveApiOptions<T> = {
  key: string
  load(): Promise<T>
  accepts?: (event: Event) => boolean
  auditMs?: number
}

type SharedQuery = ReturnType<typeof createReactiveQuery<unknown, PlatformEventMessage>>

const queries = new Map<string, SharedQuery>()

function sharedQuery<T>(options: ReactiveApiOptions<T>) {
  let query = queries.get(options.key)
  if (!query) {
    query = createReactiveQuery<T, PlatformEventMessage>({
      load: options.load,
      invalidations$: platformEventMessages(),
      accepts: (message) => options.accepts?.(message.raw) ?? true,
      auditMs: options.auditMs,
    }) as SharedQuery
    queries.set(options.key, query)
  }
  return query as ReturnType<typeof createReactiveQuery<T, PlatformEventMessage>>
}

export function useReactiveApi<T>(options: ReactiveApiOptions<T>) {
  const [query] = useState(() =>
    typeof window === 'undefined'
      ? createReactiveQuery<T, PlatformEventMessage>({
          load: options.load,
          autoStart: false,
        })
      : sharedQuery(options),
  )
  const [state, setState] = useState<ReactiveQueryState<T>>(query.snapshot)

  useEffect(() => {
    const subscription = query.state$.subscribe(setState)
    return () => subscription.unsubscribe()
  }, [query])

  return {
    ...state,
    ready: state.data !== undefined,
    refresh: query.refresh,
  }
}
